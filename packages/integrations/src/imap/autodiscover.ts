import { autodiscoverMail } from '../mail/autodiscover';

export type { MailServerConfig as AutodiscoverResult } from '../mail/autodiscover';

/**
 * @deprecated Use `autodiscoverMail(email)` and destructure `.imap`. Kept for
 * backward-compat with the initial IMAP integration; new call sites should
 * request both slots via the shared module.
 */
export async function autodiscoverImap(email: string) {
  const r = await autodiscoverMail(email);
  return r.imap;
}
