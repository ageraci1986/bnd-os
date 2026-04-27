'use server';
import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getPublicEnv } from '@/lib/env';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { getRateLimiter, getClientIp } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit';

const ForgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

export type ForgotPasswordState =
  | { readonly status: 'idle' }
  | { readonly status: 'submitted' }
  | { readonly status: 'error'; readonly message: string };

const GENERIC_OK_MESSAGE =
  "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé.";
const RATE_LIMITED_ERROR = 'Trop de demandes. Réessayez dans une heure.';

export async function forgotPassword(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  await assertCsrfFromFormData(formData);

  const parsed = ForgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    // Generic OK message even on validation failure — no email enumeration.
    return { status: 'submitted' };
  }
  const { email } = parsed.data;

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;
  const rl = getRateLimiter('password_reset');
  const limit = await rl.check(`${ip}:${email}`);
  if (!limit.success) {
    return { status: 'error', message: RATE_LIMITED_ERROR };
  }

  const supabase = await createSupabaseServer();
  const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;

  // We deliberately ignore the response — Supabase returns 200 in all cases
  // (existing or not), and we don't want to expose which it is.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/login?reset=1`,
  });

  await recordAudit({
    action: 'password_reset',
    data: { email_sha: await hashEmail(email) }, // PII-safe: keep a hash, not the address
    ip,
    userAgent: ua,
  });

  return { status: 'submitted' };
}

async function hashEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(email);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export { GENERIC_OK_MESSAGE };
