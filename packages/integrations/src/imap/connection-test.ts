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

function classify(msg: string): {
  code: Exclude<ConnectionTestResult, { ok: true }>['code'];
  message: string;
} {
  if (AUTH_PATTERNS.some((p) => p.test(msg)))
    return { code: 'AUTH', message: 'Identifiants refusés par le serveur.' };
  if (TLS_PATTERNS.some((p) => p.test(msg)))
    return { code: 'TLS', message: 'Erreur TLS/SSL avec le serveur.' };
  if (HOST_PATTERNS.some((p) => p.test(msg))) return { code: 'HOST', message: 'Hôte injoignable.' };
  if (TIMEOUT_PATTERNS.some((p) => p.test(msg)))
    return { code: 'TIMEOUT', message: "Le serveur n'a pas répondu à temps." };
  return { code: 'UNKNOWN', message: 'Erreur inconnue lors de la connexion.' };
}

export async function testImapConnection(creds: ImapCredentials): Promise<ConnectionTestResult> {
  let session;
  try {
    session = await openImapSession(creds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, ...classify(msg) };
  }
  try {
    await session.mailboxOpen('INBOX');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, ...classify(msg) };
  } finally {
    try {
      await session.logout();
    } catch {
      /* swallow */
    }
  }
}
