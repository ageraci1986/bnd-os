'use client';
import { useTransition } from 'react';
import { startGraphOAuth } from '../actions/start-graph-oauth';
import { disconnectGraph } from '../actions/disconnect-graph';

export interface OutlookCardData {
  readonly status: 'inactive' | 'active' | 'error' | 'revoked';
  readonly externalAccountLabel: string | null;
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

export function OutlookCard({ data }: { readonly data: OutlookCardData }) {
  const [pending, startTransition] = useTransition();

  const connect = (): void => {
    startTransition(async () => {
      await startGraphOAuth();
    });
  };
  const disconnect = (): void => {
    if (!window.confirm('Déconnecter cette boîte ?')) return;
    startTransition(async () => {
      const res = await disconnectGraph();
      if (!res.ok) window.alert(res.message);
      else window.location.reload();
    });
  };

  if (data.status === 'active') {
    return (
      <article className="flex items-center justify-between rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--color-bg-muted)] text-lg">
            📧
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-[color:var(--color-text-main)]">
              Microsoft Outlook
              <StatusPill kind="ok">● Connecté</StatusPill>
            </h3>
            <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">
              {data.externalAccountLabel}
              {data.lastSyncedAt ? ` · sync ${relativeTime(data.lastSyncedAt)}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={disconnect}
          disabled={pending}
          className="btn btn-ghost btn-sm"
        >
          {pending ? 'Déconnexion…' : 'Déconnecter'}
        </button>
      </article>
    );
  }

  if (data.status === 'error') {
    return (
      <article className="flex items-center justify-between rounded-2xl border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--color-bg-card)] text-lg text-[color:var(--color-danger)]">
            ⚠
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-[color:var(--color-text-main)]">
              Microsoft Outlook
              <StatusPill kind="err">● Erreur</StatusPill>
            </h3>
            <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">
              {data.lastError ?? 'Token révoqué — reconnecte ta boîte'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={connect}
          disabled={pending}
          className="btn btn-primary btn-sm"
        >
          {pending ? 'Connexion…' : 'Reconnecter'}
        </button>
      </article>
    );
  }

  // inactive | revoked
  return (
    <article className="flex items-center justify-between rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--color-bg-muted)] text-lg">
          📧
        </div>
        <div>
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-[color:var(--color-text-main)]">
            Microsoft Outlook
            <StatusPill kind="off">
              {data.status === 'revoked' ? 'Précédemment connecté' : 'Inactive'}
            </StatusPill>
          </h3>
          <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">
            Lis tes mails dans NexusHub · par utilisateur
          </p>
        </div>
      </div>
      <button type="button" onClick={connect} disabled={pending} className="btn btn-primary btn-sm">
        {pending ? 'Connexion…' : 'Connecter ma boîte'}
      </button>
    </article>
  );
}

function StatusPill({ kind, children }: { kind: 'ok' | 'err' | 'off'; children: React.ReactNode }) {
  const cls =
    kind === 'ok'
      ? 'bg-[color:var(--color-success-bg)] text-[color:var(--color-success)]'
      : kind === 'err'
        ? 'bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)]'
        : 'bg-[color:var(--color-bg-muted)] text-[color:var(--color-text-soft)]';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {children}
    </span>
  );
}
