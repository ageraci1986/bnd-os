'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { autodiscoverImap, type AutodiscoverResult } from '@nexushub/integrations/imap';

const inputSchema = z.object({ email: z.string().email().max(320) });

export type AutodiscoverImapInput = z.infer<typeof inputSchema>;

/**
 * Server Action: probe well-known IMAP autoconfig endpoints for the given
 * email's domain (Thunderbird ISPDB, Autoconfig, Autodiscover). Low-risk —
 * it only reads public provider configuration, never touches user data or
 * credentials — so no rate limit here (cf. `test-imap-connection.ts`, which
 * *is* rate-limited because it opens a live connection with a real password).
 */
export async function autodiscoverImapAction(
  raw: AutodiscoverImapInput,
): Promise<AutodiscoverResult | null> {
  await requireUser();
  const parsed = inputSchema.parse(raw);
  return autodiscoverImap(parsed.email);
}
