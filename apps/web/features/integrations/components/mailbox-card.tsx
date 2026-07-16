'use client';
import { useTransition } from 'react';
import { disconnectImapMailbox } from '../actions/disconnect-imap-mailbox';
import { disconnectGraph } from '../actions/disconnect-graph';

export interface MailboxCardData {
  readonly integrationId: string;
  readonly kind: 'graph' | 'imap';
  readonly label: string;
  readonly status: 'active' | 'error' | 'revoked';
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export function MailboxCard({
  data,
  onReconnect,
}: {
  readonly data: MailboxCardData;
  readonly onReconnect?: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const disconnect = (): void => {
    if (!window.confirm('Déconnecter cette boîte ?')) return;
    startTransition(async () => {
      const res =
        data.kind === 'graph'
          ? await disconnectGraph()
          : await disconnectImapMailbox({ integrationId: data.integrationId });
      if (!res.ok) window.alert(res.message);
      else window.location.reload();
    });
  };

  const isError = data.status === 'error';
  const cardBorderClass = isError
    ? 'border-[color:var(--color-danger)]'
    : 'border-[color:var(--color-border-light)]';
  const cardBgClass = isError
    ? 'bg-[color:var(--color-danger-bg)]'
    : 'bg-[color:var(--color-bg-card)]';

  return (
    <article
      className={`flex items-center justify-between rounded-2xl border ${cardBorderClass} ${cardBgClass} p-5 ${isError ? '' : 'shadow-[var(--shadow-card)]'}`}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
            isError
              ? 'bg-[color:var(--color-bg-card)] text-[color:var(--color-danger)]'
              : 'bg-[color:var(--color-bg-muted)]'
          }`}
        >
          {isError ? '⚠' : '📧'}
        </div>
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-[color:var(--color-text-main)]">
            <span className="truncate">{data.label}</span>
            <StatusPill kind={isError ? 'err' : 'ok'}>
              {isError ? '● Erreur' : '● Connecté'}
            </StatusPill>
          </h3>
          <p className="mt-0.5 truncate text-xs text-[color:var(--color-text-muted)]">
            {data.kind === 'graph' ? 'Microsoft Outlook' : 'IMAP'}
            {data.lastSyncedAt ? ` · sync ${relativeTime(data.lastSyncedAt)}` : ''}
            {isError && data.lastError ? ` · ${data.lastError}` : ''}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isError && onReconnect ? (
          <button type="button" onClick={onReconnect} className="btn btn-primary btn-sm">
            Reconnecter
          </button>
        ) : null}
        <button
          type="button"
          onClick={disconnect}
          disabled={pending}
          className="btn btn-ghost btn-sm"
        >
          {pending ? 'Déconnexion…' : 'Déconnecter'}
        </button>
      </div>
    </article>
  );
}

function StatusPill({ kind, children }: { kind: 'ok' | 'err'; children: React.ReactNode }) {
  const cls =
    kind === 'ok'
      ? 'bg-[color:var(--color-success-bg)] text-[color:var(--color-success)]'
      : 'bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)]';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {children}
    </span>
  );
}
