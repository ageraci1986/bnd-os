'use client';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { syncGraphInbox } from '../actions/sync-graph-inbox';

export interface MailTabsProps {
  readonly lastSyncedAt: string | null;
  readonly totalCount: number;
  readonly unreadCount: number;
  /** Toolbar slot rendered before the sync label — the mailbox filter. */
  readonly mailboxFilter?: ReactNode;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export function MailTabs({ lastSyncedAt, totalCount, unreadCount, mailboxFilter }: MailTabsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = (): void => {
    startTransition(async () => {
      await syncGraphInbox();
      router.refresh();
    });
  };
  return (
    <header className="flex items-center justify-between border-b border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-6 py-4">
      <nav className="flex items-center gap-1" aria-label="Onglets communications">
        <span className="rounded-lg bg-[color:var(--color-bg-muted)] px-3 py-2 text-sm font-bold text-[color:var(--color-accent-primary)]">
          📧 Mails
          {unreadCount > 0 ? (
            <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[color:var(--color-accent-primary)] px-1.5 py-0.5 text-[10px] font-extrabold text-white">
              {unreadCount}
            </span>
          ) : null}
        </span>
        <span
          className="cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-[color:var(--color-text-ghost)]"
          aria-disabled="true"
        >
          💬 Slack (bientôt)
        </span>
        <span
          className="cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-[color:var(--color-text-ghost)]"
          aria-disabled="true"
        >
          📝 Notes (bientôt)
        </span>
      </nav>
      <div className="flex items-center gap-3">
        {mailboxFilter}
        <span className="text-[11px] text-[color:var(--color-text-muted)]">
          {lastSyncedAt
            ? `Sync ${relativeTime(lastSyncedAt)} · ${totalCount} mails`
            : `${totalCount} mails`}
        </span>
        <button type="button" onClick={refresh} disabled={pending} className="btn btn-ghost btn-sm">
          {pending ? 'Sync…' : '↻ Actualiser'}
        </button>
      </div>
    </header>
  );
}
