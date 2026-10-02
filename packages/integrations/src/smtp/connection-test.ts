import { connectErrorSignals } from '../mail/connect-error';
import { openSmtpTransport, type SmtpCredentials } from './client';

export type SmtpConnectionTestResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'AUTH' | 'TLS' | 'HOST' | 'TIMEOUT' | 'UNKNOWN';
      readonly message: string;
    };

const AUTH_PATTERNS = [
  /authentication/i,
  /5\.7\.8/,
  /invalid credential/i,
  /auth/i,
  /login/i,
  /password/i,
];
const TLS_PATTERNS = [/ssl/i, /tls/i, /certificate/i];
const HOST_PATTERNS = [/ENOTFOUND/, /ECONNREFUSED/, /EHOSTUNREACH/, /ENETUNREACH/];
const TIMEOUT_PATTERNS = [/timeout/i, /ETIMEDOUT/, /Greeting never received/i];

function classify(err: unknown): {
  code: Exclude<SmtpConnectionTestResult, { ok: true }>['code'];
  message: string;
} {
  const { text: msg } = connectErrorSignals(err);
  // Network errno codes first: a host name like `ssl0.ovh.net` or
  // `login.example.com` echoed in a DNS error must not read as TLS/AUTH.
  if (HOST_PATTERNS.some((p) => p.test(msg)))
    return {
      code: 'HOST',
      message:
        'Serveur SMTP introuvable ou injoignable. Vérifie le nom du serveur (ex. smtp.exemple.com).',
    };
  if (AUTH_PATTERNS.some((p) => p.test(msg)))
    return { code: 'AUTH', message: 'Identifiants SMTP refusés.' };
  if (TLS_PATTERNS.some((p) => p.test(msg)))
    return { code: 'TLS', message: 'Erreur TLS/SSL avec le serveur SMTP.' };
  if (TIMEOUT_PATTERNS.some((p) => p.test(msg)))
    return { code: 'TIMEOUT', message: "Le serveur SMTP n'a pas répondu à temps." };
  return { code: 'UNKNOWN', message: 'Erreur inconnue lors de la connexion SMTP.' };
}

export async function testSmtpConnection(
  creds: SmtpCredentials,
): Promise<SmtpConnectionTestResult> {
  let transport;
  try {
    transport = await openSmtpTransport(creds);
  } catch (e) {
    return { ok: false, ...classify(e) };
  }
  try {
    transport.close();
  } catch {
    /* swallow */
  }
  return { ok: true };
}
