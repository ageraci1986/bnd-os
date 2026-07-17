'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getValidImapCredentials } from '@/features/integrations/lib/get-valid-imap-credentials';
import { openImapSession, fetchImapMessageBody } from '@nexushub/integrations/imap';

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

  // Detect cached bodies stored by an earlier version of this action (before
  // we swapped in mailparser). Two failure modes both self-heal by refetching
  // through the current mailparser pipeline — no DB migration needed:
  //
  // 1. Raw multipart still-encoded body: starts with a `--<boundary>` line
  //    AND has a `Content-Type` / `Content-Transfer-Encoding` header within
  //    the first ~500 chars (Java-mailer, Exchange, etc.).
  //
  // 2. Mojibake — the old code did `Buffer.toString('utf8')` on raw MIME
  //    bytes without honoring the message's declared charset, so any
  //    windows-1252 / iso-8859-1 byte outside ASCII got replaced by U+FFFD
  //    ('�', the "�" Unicode replacement char). Since the replacement is
  //    lossy (original byte gone), the cached body can't be salvaged in place
  //    — but a fresh IMAP fetch through mailparser reads the raw bytes again
  //    and decodes them with iconv-lite according to the Content-Type header.
  function looksLikeUnparsedMime(text: string | null): boolean {
    if (!text || text.length === 0) return false;
    const head = text.replace(/^\s+/, '').slice(0, 500);
    const firstLine = head.split(/\r?\n/, 1)[0] ?? '';
    const startsWithBoundary = /^--[A-Za-z0-9=_.:+/-]{4,}$/.test(firstLine);
    const hasMimeHeader =
      /^Content-Type:\s/im.test(head) || /^Content-Transfer-Encoding:\s/im.test(head);
    return startsWithBoundary && hasMimeHeader;
  }

  function containsMojibake(text: string | null): boolean {
    return text != null && text.includes('�');
  }

  const cachedIsUsable =
    ((mail.bodyText && mail.bodyText.length > 0) || mail.bodyHtmlSanitized !== null) &&
    !looksLikeUnparsedMime(mail.bodyText) &&
    !containsMojibake(mail.bodyText) &&
    !containsMojibake(mail.bodyHtmlSanitized);

  if (cachedIsUsable) {
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
    ({ imap: creds } = await getValidImapCredentials({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      integrationId: mail.integration.id,
    }));
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'creds error' };
  }

  const uid = Number(mail.externalId);
  if (!Number.isFinite(uid)) return { ok: false, message: 'UID invalide.' };

  // Delegate full MIME parsing + sanitize to the adapter — see
  // `packages/integrations/src/imap/body.ts` for the pipeline.
  let body: { bodyText: string; bodyHtmlSanitized: string | null } | null = null;
  try {
    const session = await openImapSession(creds);
    try {
      await session.mailboxOpen('INBOX');
      body = await fetchImapMessageBody(session, uid);
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

  if (!body) return { ok: false, message: 'Message source indisponible côté serveur IMAP.' };

  const { bodyText, bodyHtmlSanitized } = body;

  await prisma.emailMessage.update({
    where: { id: mail.id },
    data: { bodyText, bodyHtmlSanitized },
  });

  return { ok: true, bodyText, bodyHtmlSanitized };
}
