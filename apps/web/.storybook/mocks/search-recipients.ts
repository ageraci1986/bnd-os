/**
 * Storybook-only stand-in for `@/features/communications/actions/search-recipients`.
 * `RecipientField` (used by `MailDraftWidget`) imports it via a RELATIVE
 * path (`'../actions/search-recipients'`) — same `@nexushub/db`/Prisma
 * bundling crash as `fetch-mail-body.ts` in this folder documents, and the
 * reason the mock is wired in `.storybook/main.ts` via a path-matching
 * resolver rather than a plain specifier-text alias.
 */

export interface RecipientSuggestion {
  readonly email: string;
  readonly name: string | null;
  readonly source: 'mail' | 'contact';
  readonly jobTitle: string | null;
  readonly clientName: string | null;
  readonly raci: 'R' | 'A' | 'C' | 'I' | null;
}

export type SearchRecipientsResult =
  | { readonly ok: true; readonly suggestions: readonly RecipientSuggestion[] }
  | { readonly ok: false; readonly code: 'RATE_LIMIT' | 'INVALID_INPUT' };

export async function searchRecipients(
  _input: Readonly<{ query: string; limit?: number }>,
): Promise<SearchRecipientsResult> {
  return { ok: true, suggestions: [] };
}
