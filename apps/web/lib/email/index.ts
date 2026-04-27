/**
 * Email service singleton for the web app.
 *
 * Wraps `@nexushub/integrations/email` with the env-driven configuration.
 * In dev, the adapter falls back to a redacted console preview; in prod, a
 * missing RESEND_API_KEY throws at first use (configured by getEmail).
 */
import 'server-only';
import { createEmailAdapter, type EmailAdapter } from '@nexushub/integrations/email';
import { getServerEnv } from '../env';

let _email: EmailAdapter | null = null;

export function getEmail(): EmailAdapter {
  if (_email) return _email;
  const env = getServerEnv();
  _email = createEmailAdapter({
    apiKey: env.RESEND_API_KEY,
    fromEmail: env.RESEND_FROM_EMAIL,
    fromName: env.RESEND_FROM_NAME,
    devFallback: env.NODE_ENV !== 'production',
  });
  return _email;
}
