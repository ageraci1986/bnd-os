'use client';
import { useEffect, useState, useTransition, useRef } from 'react';
import { useComposePanelStore } from '@/stores/compose-panel-store';
import { useSmtpConfigStore } from '@/stores/smtp-config-store';
import { RichTextEditor } from './rich-text-editor';
import { computePrefill, type ComposePrefill } from '../lib/compose-prefill';
import { saveDraft, loadDraft, deleteDraft } from '../actions/mail-drafts';
import { sendMail } from '../actions/send-mail';
import { AddMailboxModal } from '@/features/integrations/components/add-mailbox-modal';
import { notify } from '@/features/shell/components/toaster';

export interface MailboxOption {
  readonly integrationId: string;
  readonly externalAccountId: string;
  readonly signatureHtml: string | null;
}

export function ComposePanel({ mailboxes }: { readonly mailboxes: readonly MailboxOption[] }) {
  const { isOpen, minimized, mode, replyTo, close, toggleMinimize } = useComposePanelStore();
  const [fromId, setFromId] = useState<string>(
    replyTo?.integrationId ?? mailboxes[0]?.integrationId ?? '',
  );
  const [, setPrefill] = useState<ComposePrefill>({
    toRecipients: [],
    ccRecipients: [],
    subject: '',
    bodyHtml: '',
  });
  const [to, setTo] = useState<string>('');
  const [cc, setCc] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [pending, start] = useTransition();
  const [sendError, setSendError] = useState<string | null>(null);
  const [smtpConfigRequired, setSmtpConfigRequired] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentMailbox = mailboxes.find((m) => m.integrationId === fromId) ?? mailboxes[0];

  // The AddMailboxModal (updateSmtpFor mode) emits on the shared store once
  // it has successfully saved+tested SMTP creds for this mailbox — clear
  // the banner without a full mailboxes re-fetch.
  const lastConfigured = useSmtpConfigStore((s) => s.lastConfigured);
  useEffect(() => {
    if (lastConfigured && lastConfigured === fromId) {
      setSmtpConfigRequired(false);
    }
  }, [lastConfigured, fromId]);

  // On open: load draft or compute prefill from mode + replyTo + signature
  useEffect(() => {
    if (!isOpen) return;
    void loadDraft().then((r) => {
      if (r.ok && r.draft) {
        setFromId(r.draft.fromIntegrationId);
        setTo(r.draft.toRecipients.join(', '));
        setCc(r.draft.ccRecipients.join(', '));
        setSubject(r.draft.subject);
        setBodyHtml(r.draft.bodyHtml);
        setPrefill({
          toRecipients: r.draft.toRecipients,
          ccRecipients: r.draft.ccRecipients,
          subject: r.draft.subject,
          bodyHtml: r.draft.bodyHtml,
        });
      } else {
        const p = computePrefill({
          mode,
          replyTo,
          myEmail: currentMailbox?.externalAccountId ?? '',
          signatureHtml: currentMailbox?.signatureHtml ?? null,
        });
        setTo(p.toRecipients.join(', '));
        setCc(p.ccRecipients.join(', '));
        setSubject(p.subject);
        setBodyHtml(p.bodyHtml);
        setPrefill(p);
      }
    });
    // Intentionally scoped to `isOpen` only: mode/replyTo/currentMailbox are
    // fixed at panel-open time. Re-running on their change would clobber
    // in-progress user edits.
  }, [isOpen]);

  // Auto-save: debounce 2s idle
  useEffect(() => {
    if (!isOpen) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void saveDraft({
        fromIntegrationId: fromId,
        kind: mode,
        ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
        toRecipients: to
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        ccRecipients: cc
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        bccRecipients: [],
        subject,
        bodyHtml,
      });
    }, 2_000);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [isOpen, fromId, mode, replyTo, to, cc, subject, bodyHtml]);

  async function onSend() {
    setSendError(null);
    setSmtpConfigRequired(false);
    start(async () => {
      const r = await sendMail({
        fromIntegrationId: fromId,
        mode,
        ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
        ...(replyTo?.externalId ? { replyToExternalId: replyTo.externalId } : {}),
        toRecipients: to
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        ccRecipients: cc
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        bccRecipients: [],
        subject,
        bodyHtml,
      });
      if (r.ok) {
        close();
        notify({ tone: 'success', message: 'Mail envoyé ✓' });
      } else if (r.code === 'SMTP_NOT_CONFIGURED') {
        setSmtpConfigRequired(true);
      } else {
        setSendError(`${r.code}${r.message ? `: ${r.message}` : ''}`);
        notify({
          tone: 'error',
          message: `Échec de l'envoi${r.message ? ` : ${r.message}` : ''}`,
          action: { label: 'Réessayer', onClick: () => void onSend() },
        });
      }
    });
  }

  async function onSaveDraftAndClose() {
    await saveDraft({
      fromIntegrationId: fromId,
      kind: mode,
      ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
      toRecipients: to
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      ccRecipients: cc
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      bccRecipients: [],
      subject,
      bodyHtml,
    });
    close();
  }

  async function onDiscard() {
    await deleteDraft();
    close();
  }

  if (!isOpen) return null;

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-40 w-80 rounded-t-lg border border-b-0 border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-3 py-2 shadow-lg">
        <button
          type="button"
          onClick={toggleMinimize}
          className="w-full text-left text-sm font-medium"
        >
          ↑ {subject || 'Nouveau mail'}
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Compose"
      className="fixed bottom-4 right-4 z-40 flex h-[500px] w-[600px] flex-col rounded-lg border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-[color:var(--color-border-light)] px-3 py-2 text-sm font-semibold">
        <span>
          {mode === 'new_mail'
            ? 'Nouveau mail'
            : mode === 'forward'
              ? 'Transférer'
              : mode === 'reply_all'
                ? 'Répondre à tous'
                : 'Répondre'}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={toggleMinimize} aria-label="Réduire" className="px-2">
            —
          </button>
          <button type="button" onClick={onSaveDraftAndClose} aria-label="Fermer" className="px-2">
            ×
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2">
          <label className="text-xs font-bold text-[color:var(--color-text-muted)]">De</label>
          <select
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            className="field-select ml-2 text-sm"
          >
            {mailboxes.map((m) => (
              <option key={m.integrationId} value={m.integrationId}>
                {m.externalAccountId}
              </option>
            ))}
          </select>
        </div>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="À (séparés par des virgules)"
          className="mb-2 w-full rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm"
        />
        <input
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          placeholder="Cc (optionnel)"
          className="mb-2 w-full rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm"
        />
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Objet"
          className="mb-2 w-full rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm font-medium"
        />
        <RichTextEditor value={bodyHtml} onChange={setBodyHtml} minHeight={200} />
      </div>
      <div className="border-t border-[color:var(--color-border-light)] px-3 py-2">
        {smtpConfigRequired ? (
          <div className="mb-2 rounded border border-[color:var(--color-warning)] bg-[color:var(--color-bg-muted)] px-3 py-2 text-sm">
            ⚠ Configuration SMTP requise pour <strong>{currentMailbox?.externalAccountId}</strong>.
            <button
              type="button"
              onClick={() => setShowConfigModal(true)}
              className="ml-2 underline"
            >
              Configurer maintenant
            </button>
          </div>
        ) : null}
        {sendError ? (
          <div className="mb-2 rounded bg-[color:var(--color-bg-muted)] px-2 py-1 text-xs text-[color:var(--color-danger)]">
            {sendError}
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onDiscard}
            className="text-xs text-[color:var(--color-text-muted)] hover:underline"
          >
            Supprimer le brouillon
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onSaveDraftAndClose} className="btn btn-ghost btn-sm">
              Annuler
            </button>
            <button
              type="button"
              onClick={onSend}
              disabled={pending || !to || !subject}
              className="btn btn-primary btn-sm"
            >
              {pending ? 'Envoi…' : 'Envoyer ↩'}
            </button>
          </div>
        </div>
      </div>
      {showConfigModal && currentMailbox ? (
        <AddMailboxModal
          onClose={() => setShowConfigModal(false)}
          reconnectFor={null}
          updateSmtpFor={{
            integrationId: currentMailbox.integrationId,
            email: currentMailbox.externalAccountId,
          }}
        />
      ) : null}
    </div>
  );
}
