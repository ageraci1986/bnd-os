'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { markEmailRead } from '../actions/mark-email-read';
import type { MailDTO } from '../lib/mail-dto';
import { MailReader } from './mail-reader';

export function MailList({
  mails,
  showMailboxBadge = false,
  initialSelectedId,
}: {
  readonly mails: readonly MailDTO[];
  readonly showMailboxBadge?: boolean;
  /**
   * Deep-link target (Plan 5c Task 2, `?mail=<id>`). When it names a mail
   * present in `mails`, it wins over the "first mail" default and — if that
   * mail is unread — is marked read once, mirroring a manual click.
   */
  readonly initialSelectedId?: string;
}) {
  const deepLinkTarget =
    initialSelectedId && mails.some((m) => m.id === initialSelectedId) ? initialSelectedId : null;

  const [items, setItems] = useState<readonly MailDTO[]>(mails);
  const [selectedId, setSelectedId] = useState<string | null>(
    deepLinkTarget ?? mails[0]?.id ?? null,
  );
  const [, startTransition] = useTransition();

  const select = (id: string): void => {
    setSelectedId(id);
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, isRead: true } : m)));
    startTransition(() => {
      void markEmailRead({ emailId: id });
    });
  };

  // Deep-link auto-read: run once on mount, guarded against React
  // StrictMode's double-invoke of effects — a ref (not state) survives the
  // double mount without triggering a second render/call.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    if (!deepLinkTarget) return;
    const target = mails.find((m) => m.id === deepLinkTarget);
    if (!target || target.isRead) return;
    setItems((prev) => prev.map((m) => (m.id === deepLinkTarget ? { ...m, isRead: true } : m)));
    startTransition(() => {
      void markEmailRead({ emailId: deepLinkTarget });
    });
    // Deliberately mount-only: `mails`/`deepLinkTarget` are the initial props
    // and the ref guard above already makes this a one-shot effect.
  }, []);

  const selected = items.find((m) => m.id === selectedId) ?? null;
  const unreadCount = items.filter((m) => !m.isRead).length;

  return (
    <div className="grid min-h-[460px] grid-cols-[340px_1fr]">
      <aside className="overflow-y-auto border-r border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)]">
        <div className="flex items-center justify-between border-b border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-text-muted)]">
          <span>Inbox · {items.length}</span>
          {unreadCount > 0 ? (
            <span className="text-[color:var(--color-accent-primary)]">{unreadCount} non lus</span>
          ) : null}
        </div>
        <ul className="divide-y divide-[color:var(--color-border-light)]">
          {items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => select(m.id)}
                className={[
                  'relative w-full px-4 py-3 text-left transition-colors',
                  m.id === selectedId
                    ? 'border-l-[3px] border-[color:var(--color-accent-primary)] bg-[color:var(--color-bg-card)] pl-[13px]'
                    : 'hover:bg-[color:var(--color-bg-card)]',
                ].join(' ')}
              >
                {!m.isRead ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-1 top-4 h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent-primary)]"
                  />
                ) : null}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={['flex-1 truncate text-sm', m.isRead ? '' : 'font-extrabold'].join(
                      ' ',
                    )}
                  >
                    {m.fromName ?? m.fromEmail}
                    {m.hasAttachments ? (
                      <span aria-label="Pièce jointe" className="ml-1">
                        📎
                      </span>
                    ) : null}
                    {showMailboxBadge && m.mailboxLabel ? (
                      <span className="ml-2 text-xs font-normal text-[color:var(--color-text-muted)]">
                        · {m.mailboxLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11px] text-[color:var(--color-text-muted)]">
                    {new Date(m.receivedAt).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs">
                  {m.subject || '(sans sujet)'}
                  {m.sendStatus === 'sent' ? (
                    <span className="ml-1 text-xs text-[color:var(--color-success)]">✓ Envoyé</span>
                  ) : m.sendStatus === 'queued' || m.sendStatus === 'sending' ? (
                    <span className="ml-1 text-xs text-[color:var(--color-text-muted)]">
                      Envoi…
                    </span>
                  ) : m.sendStatus === 'failed' ? (
                    <span className="ml-1 text-xs text-[color:var(--color-danger)]">⚠ Échec</span>
                  ) : null}
                </div>
                <div className="truncate text-[11px] text-[color:var(--color-text-muted)]">
                  {m.preview}
                </div>
                {m.client ? (
                  <span
                    className="mt-1 inline-flex items-center gap-1 rounded-full bg-[color:var(--color-bg-muted)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
                    style={{ color: `var(--${m.client.colorToken})` }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: `var(--${m.client.colorToken})` }}
                    />
                    {m.client.name}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <MailReader mail={selected} />
    </div>
  );
}
