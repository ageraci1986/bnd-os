/**
 * Cross-component notification when SMTP config is added to a mailbox.
 *
 * `ComposePanel` shows an inline banner when `sendMail` returns
 * `SMTP_NOT_CONFIGURED`. The user fixes it via `AddMailboxModal`'s
 * `updateSmtpFor` mode, which runs in a separate render tree (rendered by
 * `ComposePanel` itself, but conceptually a standalone flow). This tiny
 * event bus lets the modal announce "integration X now has SMTP" so
 * `ComposePanel` can clear its banner without prop drilling or a shared
 * parent re-fetch.
 */
import { create } from 'zustand';

interface State {
  readonly lastConfigured: string | null;
  readonly emit: (integrationId: string) => void;
}

export const useSmtpConfigStore = create<State>((set) => ({
  lastConfigured: null,
  emit: (id) => set({ lastConfigured: id }),
}));
