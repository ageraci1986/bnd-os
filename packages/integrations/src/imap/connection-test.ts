import { connectErrorSignals } from '../mail/connect-error';
import { openImapSession, type ImapCredentials } from './client';

export type ConnectionTestResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'AUTH' | 'TLS' | 'HOST' | 'TIMEOUT' | 'UNKNOWN';
      readonly message: string;
    };

const AUTH_PATTERNS = [/invalid credential/i, /auth/i, /login/i, /password/i];
const TLS_PATTERNS = [/ssl/i, /tls/i, /certificate/i];
const HOST_PATTERNS = [/ENOTFOUND/, /ECONNREFUSED/, /EHOSTUNREACH/, /ENETUNREACH/];
const TIMEOUT_PATTERNS = [/timeout/i, /ETIMEDOUT/];

function classify(err: unknown): {
  code: Exclude<ConnectionTestResult, { ok: true }>['code'];
  message: string;
} {
  const { text: msg, authFailed } = connectErrorSignals(err);
  if (authFailed) return { code: 'AUTH', message: 'Identifiants refusés par le serveur.' };
  // Network errno codes first: a host name like `ssl0.ovh.net` or
  // `login.example.com` echoed in a DNS error must not read as TLS/AUTH.
  if (HOST_PATTERNS.some((p) => p.test(msg)))
    return {
      code: 'HOST',
      message:
        'Serveur introuvable ou injoignable. Vérifie le nom du serveur (ex. imap.exemple.com).',
    };
  if (AUTH_PATTERNS.some((p) => p.test(msg)))
    return { code: 'AUTH', message: 'Identifiants refusés par le serveur.' };
  if (TLS_PATTERNS.some((p) => p.test(msg)))
    return { code: 'TLS', message: 'Erreur TLS/SSL avec le serveur.' };
  if (TIMEOUT_PATTERNS.some((p) => p.test(msg)))
    return { code: 'TIMEOUT', message: "Le serveur n'a pas répondu à temps." };
  return { code: 'UNKNOWN', message: 'Erreur inconnue lors de la connexion.' };
}

export async function testImapConnection(creds: ImapCredentials): Promise<ConnectionTestResult> {
  let session;
  try {
    session = await openImapSession(creds);
  } catch (e) {
    return { ok: false, ...classify(e) };
  }
  try {
    await session.mailboxOpen('INBOX');
    return { ok: true };
  } catch (e) {
    return { ok: false, ...classify(e) };
  } finally {
    try {
      await session.logout();
    } catch {
      /* swallow */
    }
  }
}
