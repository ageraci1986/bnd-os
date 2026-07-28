/**
 * Storybook-only stand-in for `@/features/communications/actions/mark-email-read`.
 * See `fetch-mail-body.ts` in this folder for why this alias exists.
 */

export type MarkEmailReadResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function markEmailRead(
  _input: Readonly<{ emailId: string }>,
): Promise<MarkEmailReadResult> {
  return { ok: false, message: 'Storybook : Server Action non mockée ici.' };
}
