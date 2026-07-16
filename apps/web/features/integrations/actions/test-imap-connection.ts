'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { testImapConnection, type ConnectionTestResult } from '@nexushub/integrations/imap';

const inputSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().positive().max(65535),
  secure: z.boolean(),
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
});

export type TestImapInput = z.infer<typeof inputSchema>;
export type TestImapResult =
  | ConnectionTestResult
  | { readonly ok: false; readonly code: 'RATE_LIMIT'; readonly message: string };

export async function testImapConnectionAction(raw: TestImapInput): Promise<TestImapResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const rl = getRateLimiter('imap_test');
  const rlRes = await rl.check(ctx.userId);
  if (!rlRes.success) {
    return {
      ok: false,
      code: 'RATE_LIMIT',
      message: 'Trop de tentatives de test. Réessaie dans quelques minutes.',
    };
  }
  return testImapConnection(parsed);
}
