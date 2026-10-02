/**
 * Reduce whatever the user typed in a "mail server" field to a bare host.
 *
 * Users routinely paste a URL (`http://ex3.mail.ovh.net/`) or append the
 * port (`imap.example.com:993`). Passed as-is to imapflow/nodemailer, that
 * string goes straight to DNS and fails with ENOTFOUND — so we strip the
 * scheme, userinfo, path/query/fragment, port and trailing dot, and
 * lowercase. Bracketed IPv6 literals are kept intact.
 */
export function normalizeMailHost(input: string): string {
  let h = input.trim();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  h = h.split(/[/?#]/, 1)[0] ?? '';
  const at = h.lastIndexOf('@');
  if (at !== -1) h = h.slice(at + 1);
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1).toLowerCase();
  }
  h = h.replace(/:\d*$/, '').replace(/\.$/, '');
  return h.toLowerCase();
}
