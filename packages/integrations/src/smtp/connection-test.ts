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

function classify(msg: string): {
  code: Exclude<SmtpConnectionTestResult, { ok: true }>['code'];
  message: string;
} {
  if (AUTH_PATTERNS.some((p) => p.test(msg)))
    return { code: 'AUTH', message: 'Identifiants SMTP refusés.' };
  if (TLS_PATTERNS.some((p) => p.test(msg)))
    return { code: 'TLS', message: 'Erreur TLS/SSL avec le serveur SMTP.' };
  if (HOST_PATTERNS.some((p) => p.test(msg)))
    return { code: 'HOST', message: 'Serveur SMTP injoignable.' };
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
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, ...classify(msg) };
  }
  try {
    transport.close();
  } catch {
    /* swallow */
  }
  return { ok: true };
}
