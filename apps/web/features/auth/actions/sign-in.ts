'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServer } from '@/lib/supabase/server';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { getRateLimiter, getClientIp } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit';

const SignInSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
  next: z
    .string()
    .startsWith('/')
    .regex(/^\/[^/]/) // forbid protocol-relative `//evil.com` redirects
    .max(256)
    .optional(),
});

export type SignInState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string };

const GENERIC_ERROR = 'Identifiants invalides ou compte inexistant.';
const RATE_LIMITED_ERROR = 'Trop de tentatives. Réessayez dans quelques minutes.';

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  await assertCsrfFromFormData(formData);

  const parsed = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: GENERIC_ERROR };
  }
  const { email, password, next } = parsed.data;

  // Rate limit: 5 attempts / 15 min, keyed by IP + email (defense in depth).
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;
  const rl = getRateLimiter('login');
  const limit = await rl.check(`${ip}:${email}`);
  if (!limit.success) {
    await recordAudit({
      action: 'login_failed',
      data: { reason: 'rate_limited' },
      ip,
      userAgent: ua,
    });
    return { status: 'error', message: RATE_LIMITED_ERROR };
  }

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    await recordAudit({
      action: 'login_failed',
      data: { reason: 'invalid_credentials' },
      ip,
      userAgent: ua,
    });
    // Generic message: never disclose whether the email exists or the password is wrong.
    return { status: 'error', message: GENERIC_ERROR };
  }

  await recordAudit({
    action: 'login_success',
    actorId: data.user.id,
    ip,
    userAgent: ua,
  });

  redirect(next ?? '/overview');
}
