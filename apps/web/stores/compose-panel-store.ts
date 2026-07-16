/**
 * UI-only state for the mail compose panel (Communications).
 *
 * Mirrors the convention used by `mailbox-filter-store.ts`: a lean Zustand
 * store holding transient panel state (open/minimized/mode/replyTo context).
 * Unlike the mailbox filter, this state is not reflected in the URL — the
 * compose panel is an overlay, not a navigable view.
 */
import { create } from 'zustand';

export interface ComposeReplyContext {
  readonly id: string;
  readonly externalId: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bodyText: string;
  readonly bodyHtmlSanitized: string | null;
  readonly receivedAt: string;
  readonly integrationId: string;
}

interface State {
  readonly isOpen: boolean;
  readonly minimized: boolean;
  readonly mode: 'reply' | 'reply_all' | 'forward' | 'new_mail';
  readonly replyTo: ComposeReplyContext | null;
  readonly open: (input: { mode: State['mode']; replyTo?: ComposeReplyContext | null }) => void;
  readonly close: () => void;
  readonly toggleMinimize: () => void;
}

export const useComposePanelStore = create<State>((set) => ({
  isOpen: false,
  minimized: false,
  mode: 'new_mail',
  replyTo: null,
  open: ({ mode, replyTo }) =>
    set({ isOpen: true, minimized: false, mode, replyTo: replyTo ?? null }),
  close: () => set({ isOpen: false, minimized: false, replyTo: null, mode: 'new_mail' }),
  toggleMinimize: () => set((s) => ({ minimized: !s.minimized })),
}));
