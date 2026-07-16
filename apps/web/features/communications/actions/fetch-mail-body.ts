'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getValidImapCredentials } from '@/features/integrations/lib/get-valid-imap-credentials';
import { openImapSession } from '@nexushub/integrations/imap';
import { sanitizeMailHtml, stripMailHtmlToText } from '@nexushub/integrations/mail';

const inputSchema = z.object({ emailId: z.string().uuid() });

export type FetchMailBodyResult =
  | {
      readonly ok: true;
      readonly bodyText: string;
      readonly bodyHtmlSanitized: string | null;
    }
  | { readonly ok: false; readonly message: string };

/**
 * On-demand body fetch for a single mail. The IMAP sync fetches envelopes only
 * (skipping per-message downloads avoids blowing past the serverless timeout
 * on the initial sync). When the user opens a mail whose body is empty, we
 * fetch just that one body from IMAP and cache it in the DB row so subsequent
 * opens are instant.
 *
 * Graph mails always store their body inline during sync, so this action
 * short-circuits for them and returns whatever is already in the DB.
 *
 * Ownership check is mandatory (CLAUDE.md §4.4.2): the target `EmailMessage`
 * must belong to a workspace + integration the caller owns.
 */
export async function fetchMailBody(
  raw: z.infer<typeof inputSchema>,
): Promise<FetchMailBodyResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);

  const mail = await prisma.emailMessage.findFirst({
    where: {
      id: parsed.emailId,
      workspaceId: ctx.workspaceId,
      integration: {
        workspaceId: ctx.workspaceId,
        ownerUserId: ctx.userId,
      },
    },
    select: {
      id: true,
      externalId: true,
      bodyText: true,
      bodyHtmlSanitized: true,
      integration: { select: { id: true, kind: true, status: true } },
    },
  });

  if (!mail) return { ok: false, message: 'Email introuvable.' };

  // Body already cached — return as-is (covers Graph, and IMAP mails whose
  // body was fetched by a previous call).
  const alreadyLoaded =
    (mail.bodyText && mail.bodyText.length > 0) || mail.bodyHtmlSanitized !== null;
  if (alreadyLoaded) {
    return {
      ok: true,
      bodyText: mail.bodyText ?? '',
      bodyHtmlSanitized: mail.bodyHtmlSanitized,
    };
  }

  if (mail.integration.kind !== 'imap') {
    // Graph body is expected to be inline; empty just means the message truly
    // had no body content. Return empty as-is.
    return { ok: true, bodyText: '', bodyHtmlSanitized: null };
  }

  if (mail.integration.status !== 'active') {
    return { ok: false, message: 'La boîte IMAP source est déconnectée.' };
  }

  let creds;
  try {
    creds = await getValidImapCredentials({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      integrationId: mail.integration.id,
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'creds error' };
  }

  const uid = Number(mail.externalId);
  if (!Number.isFinite(uid)) return { ok: false, message: 'UID invalide.' };

  let raw_body: { text: string | null; html: string | null } = { text: null, html: null };
  try {
    const session = await openImapSession(creds);
    try {
      await session.mailboxOpen('INBOX');
      // `{ uid: true }` interprets the range in UID space (matching what we
      // stored during sync), not IMAP sequence-number space.
      const dl = await session.download(uid, 'TEXT', { uid: true });
      if (dl?.content) {
        const chunks: Buffer[] = [];
        const content = dl.content as unknown;
        if (Buffer.isBuffer(content)) {
          chunks.push(content);
        } else if (
          content &&
          typeof (content as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
        ) {
          for await (const chunk of content as AsyncIterable<Buffer | string>) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
        }
        const text = Buffer.concat(chunks).toString('utf8');
        if (text) {
          const looksHtml = text.trimStart().startsWith('<');
          raw_body = looksHtml ? { text: null, html: text } : { text, html: null };
        }
      }
    } finally {
      try {
        await session.logout();
      } catch {
        /* swallow */
      }
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'IMAP body fetch failed' };
  }

  const bodyHtmlSanitized = raw_body.html ? sanitizeMailHtml(raw_body.html) : null;
  const bodyText = raw_body.html ? stripMailHtmlToText(raw_body.html) : (raw_body.text ?? '');

  await prisma.emailMessage.update({
    where: { id: mail.id },
    data: { bodyText, bodyHtmlSanitized },
  });

  return { ok: true, bodyText, bodyHtmlSanitized };
}
