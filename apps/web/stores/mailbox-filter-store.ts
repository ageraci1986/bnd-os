/**
 * UI-only mirror of the `?mailbox=<integrationId>` filter (Communications).
 *
 * Follows the same URL-is-source-of-truth convention as the client filter
 * (see `apps/web/features/shell/lib/client-filter-url.ts`): the store never
 * initiates navigation itself, it is hydrated from the server-resolved URL
 * param on mount so cross-tab/back-forward navigation stays authoritative.
 */
import { create } from 'zustand';

interface State {
  readonly mailboxId: string | null;
  readonly setMailboxId: (id: string | null) => void;
}

export const useMailboxFilterStore = create<State>((set) => ({
  mailboxId: null,
  setMailboxId: (id) => set({ mailboxId: id }),
}));
