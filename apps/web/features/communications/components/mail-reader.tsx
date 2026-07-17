'use client';
import { useEffect, useState, useTransition } from 'react';
import { fetchMailBody } from '../actions/fetch-mail-body';
import { retrySendMail } from '../actions/retry-send-mail';
import { MailAttachmentRow } from './mail-attachment-row';
import type { MailDTO } from '../lib/mail-dto';
import { useComposePanelStore } from '@/stores/compose-panel-store';
import { notify } from '@/features/shell/components/toaster';

function initials(name: string | null, email: string): string {
  const src = name ?? email;
  const parts = src.split(/[\s.@]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '');
}

interface BodyState {
  readonly bodyText: string;
  readonly bodyHtmlSanitized: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export function MailReader({ mail }: { readonly mail: MailDTO | null }) {
  const [retryPending, startRetry] = useTransition();
  const [body, setBody] = useState<BodyState>(() => ({
    bodyText: mail?.bodyText ?? '',
    bodyHtmlSanitized: mail?.bodyHtmlSanitized ?? null,
    loading: false,
    error: null,
  }));

  useEffect(() => {
    if (!mail) return;
    // Always ask the server — it's the single source of truth for whether
    // the cached body is good, needs a MIME re-parse, or is truly empty.
    // The DB round-trip is cheap; only actually broken bodies trigger an
    // IMAP session. Falling back to `!mail.bodyHtmlSanitized && !mail.bodyText`
    // client-side missed raw-MIME bodies stored by an older code path
    // (non-empty but unusable).
    let cancelled = false;
    setBody({
      bodyText: mail.bodyText ?? '',
      bodyHtmlSanitized: mail.bodyHtmlSanitized,
      loading: true,
      error: null,
    });
    void fetchMailBody({ emailId: mail.id }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setBody({
          bodyText: r.bodyText,
          bodyHtmlSanitized: r.bodyHtmlSanitized,
          loading: false,
          error: null,
        });
      } else {
        // Server refused — keep whatever we already had (may still be raw
        // MIME, but at least the user sees SOMETHING and the error).
        setBody((prev) => ({ ...prev, loading: false, error: r.message }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mail]);

  if (!mail) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-[color:var(--color-text-muted)]">
        Sélectionne un mail à gauche.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto bg-[color:var(--color-bg-card)] p-7">
      <h2 className="mb-3 text-lg font-extrabold text-[color:var(--color-text-main)]">
        {mail.subject || '(sans sujet)'}
      </h2>
      <div className="mb-5 flex items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {initials(mail.fromName, mail.fromEmail)}
        </span>
        <div className="leading-tight">
          <div className="text-sm font-bold text-[color:var(--color-text-main)]">
            {mail.fromName ?? mail.fromEmail}
            {mail.client ? (
              <span
                className="ml-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--color-bg-muted)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
                style={{ color: `var(--${mail.client.colorToken})` }}
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: `var(--${mail.client.colorToken})` }}
                />
                {mail.client.name}
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-[color:var(--color-text-muted)]">{mail.fromEmail}</div>
          <div className="text-[11px] text-[color:var(--color-text-muted)]">
            {new Date(mail.receivedAt).toLocaleString('fr-FR', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
            {mail.toRecipients.length > 0 ? ` — à ${mail.toRecipients.join(', ')}` : ''}
          </div>
        </div>
      </div>
      {body.loading ? (
        <div className="py-8 text-center text-sm text-[color:var(--color-text-muted)]">
          Chargement du contenu…
        </div>
      ) : body.error ? (
        <div className="rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-bg-muted)] px-4 py-3 text-sm text-[color:var(--color-danger)]">
          Impossible de charger le contenu : {body.error}
        </div>
      ) : body.bodyHtmlSanitized ? (
        <div
          className="text-sm leading-relaxed text-[color:var(--color-text-soft)]"
          dangerouslySetInnerHTML={{ __html: body.bodyHtmlSanitized }}
        />
      ) : body.bodyText ? (
        <pre className="whitespace-pre-wrap font-sans text-sm text-[color:var(--color-text-soft)]">
          {body.bodyText}
        </pre>
      ) : (
        <div className="py-8 text-center text-sm text-[color:var(--color-text-muted)]">
          (Aucun contenu)
        </div>
      )}
      {mail.attachments.length > 0 ? (
        <div className="mt-4 rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] p-3">
          <div className="mb-2 text-xs font-bold text-[color:var(--color-text-muted)]">
            📎 Pièces jointes ({mail.attachments.length})
          </div>
          <ul className="flex flex-col gap-1">
            {mail.attachments.map((a) => (
              <MailAttachmentRow key={a.id} attachment={a} />
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-6 flex items-center gap-2">
        {mail.sendStatus === 'failed' ? (
          <button
            type="button"
            disabled={retryPending}
            onClick={() =>
              startRetry(async () => {
                const r = await retrySendMail({ emailMessageId: mail.id });
                if (r.ok) {
                  notify({ tone: 'success', message: 'Mail envoyé ✓' });
                } else {
                  notify({
                    tone: 'error',
                    message: `Échec de l'envoi${r.message ? ` : ${r.message}` : ''}`,
                  });
                }
              })
            }
            className="btn btn-primary btn-sm"
          >
            {retryPending ? 'Envoi…' : 'Réessayer'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() =>
            useComposePanelStore.getState().open({
              mode: 'reply',
              replyTo: {
                id: mail.id,
                externalId: mail.externalId,
                subject: mail.subject,
                fromEmail: mail.fromEmail,
                toRecipients: mail.toRecipients,
                ccRecipients: mail.ccRecipients,
                bodyText: mail.bodyText,
                bodyHtmlSanitized: mail.bodyHtmlSanitized,
                receivedAt: mail.receivedAt,
                integrationId: mail.integrationId,
              },
            })
          }
          className="btn btn-primary btn-sm"
        >
          ↩ Répondre
        </button>
        <button
          type="button"
          onClick={() =>
            useComposePanelStore.getState().open({
              mode: 'reply_all',
              replyTo: {
                id: mail.id,
                externalId: mail.externalId,
                subject: mail.subject,
                fromEmail: mail.fromEmail,
                toRecipients: mail.toRecipients,
                ccRecipients: mail.ccRecipients,
                bodyText: mail.bodyText,
                bodyHtmlSanitized: mail.bodyHtmlSanitized,
                receivedAt: mail.receivedAt,
                integrationId: mail.integrationId,
              },
            })
          }
          className="btn btn-ghost btn-sm"
        >
          ↩↩ Répondre à tous
        </button>
        <button
          type="button"
          onClick={() =>
            useComposePanelStore.getState().open({
              mode: 'forward',
              replyTo: {
                id: mail.id,
                externalId: mail.externalId,
                subject: mail.subject,
                fromEmail: mail.fromEmail,
                toRecipients: mail.toRecipients,
                ccRecipients: mail.ccRecipients,
                bodyText: mail.bodyText,
                bodyHtmlSanitized: mail.bodyHtmlSanitized,
                receivedAt: mail.receivedAt,
                integrationId: mail.integrationId,
              },
            })
          }
          className="btn btn-ghost btn-sm"
        >
          ➡ Transférer
        </button>
      </div>
    </div>
  );
}
