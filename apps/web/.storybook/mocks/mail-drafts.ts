/**
 * Storybook-only stand-in for `@/features/communications/actions/mail-drafts`.
 * See `fetch-mail-body.ts` in this folder for why this alias exists.
 *
 * `loadDraft` rejects on purpose: `MailDraftWidget` always calls it on mount
 * (its brouillon DB is the source of truth — the tool's JSON payload is only
 * a preview, see the widget's own doc comment) and there is no Server Action
 * runtime in Storybook to answer it. The widget's `useEffect` catches the
 * rejection and settles into its documented `'unavailable'` phase — fields
 * disabled, `LOAD_FAILED_NOTE` shown — which is exactly the state the
 * `MailDraftWidget` story renders.
 */

export interface DraftDto {
  readonly id: string;
  readonly fromIntegrationId: string;
  readonly kind: 'reply' | 'reply_all' | 'forward' | 'new_mail';
  readonly replyToId: string | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bccRecipients: readonly string[];
  readonly subject: string;
  readonly bodyHtml: string;
  readonly composeAttachments: readonly unknown[];
  readonly updatedAt: string;
}

export async function loadDraft(): Promise<{ ok: true; draft: DraftDto | null }> {
  throw new Error('Storybook : chargement du brouillon indisponible (Server Action non mockée).');
}

export async function saveDraft(
  _input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  return { ok: false, message: 'Storybook : Server Action non mockée ici.' };
}
