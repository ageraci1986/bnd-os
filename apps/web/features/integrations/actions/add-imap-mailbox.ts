'use server';
import 'server-only';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { encryptSecret } from '@/lib/oauth/crypto';
import { testImapConnection } from '@nexushub/integrations/imap';

const inputSchema = z.object({
  email: z.string().email().max(320),
  host: z.string().min(1).max(255),
  port: z.number().int().positive().max(65535),
  secure: z.boolean(),
  password: z.string().min(1).max(1024),
});

export type AddImapInput = z.infer<typeof inputSchema>;
export type AddImapResult =
  | { readonly ok: true; readonly integrationId: string }
  | { readonly ok: false; readonly message: string };

/**
 * `instanceof Prisma.PrismaClientKnownRequestError` doesn't reliably hold
 * across Turbopack's RSC module boundary (Prisma is loaded twice and the
 * class identity diverges), so we sniff by error.code directly — same
 * pattern used in `features/projects/actions/card-assignees.ts`.
 */
function prismaErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * The ciphertext format is `v1:<keyVersion>:<iv>:<tag>:<ct>` (see
 * `lib/oauth/crypto.ts`) — reading the version back out of what
 * `encryptSecret` just produced keeps the DB column and the ciphertext
 * self-consistent without a second, independently-timed env lookup.
 */
function keyVersionFromCiphertext(ciphertext: string): number {
  const version = Number(ciphertext.split(':')[1]);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

/**
 * Server Action: connect a new IMAP mailbox (CLAUDE.md §4.2, §4.4).
 *
 * Flow: requireUser() → test the connection live → encrypt credentials →
 * create the Integration row (scope='user', per-user mailbox) → PII-safe
 * audit log → redirect to the integrations page.
 *
 * SECURITY: credentials are only ever held in memory here. The encrypted
 * blob and the raw password never appear in the audit log payload.
 */
export async function addImapMailbox(raw: AddImapInput): Promise<AddImapResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const email = parsed.email.toLowerCase();

  const test = await testImapConnection({
    host: parsed.host,
    port: parsed.port,
    secure: parsed.secure,
    username: email,
    password: parsed.password,
  });
  if (!test.ok) {
    return { ok: false, message: `Connexion refusée (${test.code}).` };
  }

  const encrypted = encryptSecret(
    JSON.stringify({
      host: parsed.host,
      port: parsed.port,
      secure: parsed.secure,
      username: email,
      password: parsed.password,
    }),
  );

  let created: { id: string };
  try {
    created = await prisma.integration.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerUserId: ctx.userId,
        kind: 'imap',
        scope: 'user',
        status: 'active',
        externalAccountId: email,
        externalAccountLabel: email,
        encryptedTokens: encrypted,
        keyVersion: keyVersionFromCiphertext(encrypted),
        grantedScopes: [],
      },
      select: { id: true },
    });
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') {
      return { ok: false, message: 'Cette boîte est déjà connectée.' };
    }
    throw err;
  }

  // SECURITY: audit log must be PII-safe re: secrets — no password, no
  // encrypted blob. The mailbox address itself is legitimate connection
  // metadata for the audit trail (cf. graph callback's `integration_connected`).
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'integration_connected',
      data: { kind: 'imap', email, host: parsed.host, port: parsed.port, secure: parsed.secure },
    },
  });

  redirect('/integrations?connected=imap');
  // Unreachable at runtime — redirect() throws NEXT_REDIRECT — kept so the
  // function stays typed as returning AddImapResult for callers under test.
  return { ok: true, integrationId: created.id };
}
