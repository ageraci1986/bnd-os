/**
 * Storybook-only stand-in for `@/features/communications/actions/mark-email-unread`.
 * See `fetch-mail-body.ts` in this folder for why this alias exists.
 */

export type MarkEmailUnreadResult =
  | { readonly ok: true; readonly affected: number }
  | { readonly ok: false; readonly message: string };

export async function markEmailUnread(
  _input: Readonly<{ emailId: string }>,
): Promise<MarkEmailUnreadResult> {
  return { ok: false, message: 'Storybook : Server Action non mockée ici.' };
}
