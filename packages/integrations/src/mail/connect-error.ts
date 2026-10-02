const MAX_CAUSE_DEPTH = 5;

/**
 * Flatten a connection error into text the IMAP/SMTP classifiers can match.
 *
 * Our clients wrap library errors (`ImapConnectionError('IMAP connect
 * failed', cause)`), so the useful detail — `ENOTFOUND`, imapflow's
 * `authenticationFailed`/`responseText`, nodemailer's `EAUTH`/`response` —
 * lives on the `cause` chain, not on the top-level message.
 *
 * SECURITY: the result is only used for classification; it is never
 * returned to the client nor logged.
 */
export function connectErrorSignals(err: unknown): { text: string; authFailed: boolean } {
  const parts: string[] = [];
  let authFailed = false;
  const seen = new Set<unknown>();
  let cur: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && cur != null && !seen.has(cur); depth++) {
    seen.add(cur);
    if (typeof cur !== 'object') {
      parts.push(String(cur));
      break;
    }
    const e = cur as Record<string, unknown>;
    for (const key of ['message', 'code', 'responseText', 'response'] as const) {
      const v = e[key];
      if (typeof v === 'string' && v.length > 0) parts.push(v);
    }
    if (e['authenticationFailed'] === true) authFailed = true;
    cur = e['cause'];
  }
  return { text: parts.join(' | '), authFailed };
}
