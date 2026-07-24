'use client';
import { useEffect, useState, useTransition, useRef } from 'react';
import { useComposePanelStore } from '@/stores/compose-panel-store';
import { useSmtpConfigStore } from '@/stores/smtp-config-store';
import { RichTextEditor } from './rich-text-editor';
import { AttachmentDrop } from './attachment-drop';
import { RecipientField } from './recipient-field';
import { useAttachmentUploader, type UploadedAttachment } from '../hooks/use-attachment-uploader';
import { computePrefill, type ComposePrefill } from '../lib/compose-prefill';
import { isValidEmail } from '../lib/recipient-match';
import { saveDraft, loadDraft, deleteDraft } from '../actions/mail-drafts';
import { sendMail } from '../actions/send-mail';
import { loadForwardAttachments } from '../actions/load-forward-attachments';
import { removeAttachmentFromDraft } from '../actions/remove-attachment-from-draft';
import { AddMailboxModal } from '@/features/integrations/components/add-mailbox-modal';
import { notify } from '@/features/shell/components/toaster';

export interface MailboxOption {
  readonly integrationId: string;
  readonly externalAccountId: string;
  readonly signatureHtml: string | null;
}

/** Shared shape between DraftDto.composeAttachments entries and
 * loadForwardAttachments' `added` entries — both carry the fields the
 * uploader needs, always in a terminal ('clean') state since only clean
 * entries are ever persisted (see mail-drafts.ts / load-forward-attachments.ts). */
function toUploadedAttachment(a: {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly storagePath: string;
  readonly sha256: string;
}): UploadedAttachment {
  return {
    id: a.id,
    filename: a.filename,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    storagePath: a.storagePath,
    sha256: a.sha256,
    state: 'clean',
  };
}

/** `saveDraft`/`sendMail` only ever want the attachments that finished
 * uploading cleanly — 'uploading' placeholders and 'dirty'/'error' rows are
 * local-only UI state, never sent to the server. */
function toAttachmentDraftPayload(items: readonly UploadedAttachment[]) {
  return items
    .filter((x) => x.state === 'clean')
    .map((x) => ({
      id: x.id,
      filename: x.filename,
      contentType: x.contentType,
      sizeBytes: x.sizeBytes,
      storagePath: x.storagePath,
      sha256: x.sha256,
    }));
}

/**
 * Spec §11 (Communications iter V1.5, mail attachments) prescribes exact
 * French copy for the Graph 3 MB attachments cap. Every other new send
 * failure code's server-provided `message` (see send-mail.ts) is already
 * the right actionable French text, so this only overrides the one case.
 */
function attachmentFailureCopy(code: string): string | null {
  if (code === 'SEND_FAILED_TOO_LARGE') {
    return 'Ce mail dépasse la limite Microsoft Graph (3 MB de pièces jointes). Réduis la taille ou utilise une boîte IMAP.';
  }
  return null;
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
  const [toList, setToList] = useState<readonly string[]>([]);
  const [ccList, setCcList] = useState<readonly string[]>([]);
  const [bccList, setBccList] = useState<readonly string[]>([]);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [pending, start] = useTransition();
  const [sendError, setSendError] = useState<string | null>(null);
  const [smtpConfigRequired, setSmtpConfigRequired] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [forwardLoading, setForwardLoading] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploader = useAttachmentUploader();

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

  // On open: load draft or compute prefill from mode + replyTo + signature.
  // Skip the draft load when the user clicked "Nouveau mail" — resuming a
  // half-finished reply/forward there would be confusing (they explicitly
  // asked for a fresh compose). Autosave will overwrite the persisted draft
  // as soon as the user types anything.
  useEffect(() => {
    if (!isOpen) return;
    const load =
      mode === 'new_mail' ? Promise.resolve({ ok: true as const, draft: null }) : loadDraft();
    void load.then(async (r) => {
      if (r.ok && r.draft) {
        setFromId(r.draft.fromIntegrationId);
        setToList(r.draft.toRecipients);
        setCcList(r.draft.ccRecipients);
        setBccList(r.draft.bccRecipients);
        setSubject(r.draft.subject);
        setBodyHtml(r.draft.bodyHtml);
        setPrefill({
          toRecipients: r.draft.toRecipients,
          ccRecipients: r.draft.ccRecipients,
          subject: r.draft.subject,
          bodyHtml: r.draft.bodyHtml,
        });
        uploader.setInitial(r.draft.composeAttachments.map(toUploadedAttachment));
        return;
      }

      const p = computePrefill({
        mode,
        replyTo,
        myEmail: currentMailbox?.externalAccountId ?? '',
        signatureHtml: currentMailbox?.signatureHtml ?? null,
      });
      setToList(p.toRecipients);
      setCcList(p.ccRecipients);
      setBccList([]);
      setSubject(p.subject);
      setBodyHtml(p.bodyHtml);
      setPrefill(p);

      // Forward reprise (Task 17): only for a brand-new draft — an existing
      // draft (handled in the `if` branch above) already persisted its
      // reprised attachments the first time this ran, so re-triggering here
      // would double-add them (loadForwardAttachments has no dedupe against
      // already-reprised source ids). A draft row must exist before we can
      // target it, so we create one via saveDraft first.
      if (mode === 'forward' && replyTo?.id) {
        setForwardLoading(true);
        try {
          const saved = await saveDraft({
            fromIntegrationId: fromId,
            kind: mode,
            replyToId: replyTo.id,
            toRecipients: [...p.toRecipients],
            ccRecipients: [...p.ccRecipients],
            bccRecipients: [],
            subject: p.subject,
            bodyHtml: p.bodyHtml,
          });
          if (saved.ok) {
            const fr = await loadForwardAttachments({
              emailMessageId: replyTo.id,
              draftId: saved.id,
            });
            if (fr.ok) {
              uploader.setInitial(fr.added.map(toUploadedAttachment));
              if (fr.skipped.length > 0) {
                notify({
                  tone: 'info',
                  message: `${fr.skipped.length} pièce(s) jointe(s) d'origine non reprise(s).`,
                });
              }
            }
          }
        } finally {
          setForwardLoading(false);
        }
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
        toRecipients: [...toList],
        ccRecipients: [...ccList],
        bccRecipients: [...bccList],
        subject,
        bodyHtml,
        composeAttachments: toAttachmentDraftPayload(uploader.items),
      });
    }, 2_000);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [isOpen, fromId, mode, replyTo, toList, ccList, bccList, subject, bodyHtml, uploader.items]);

  async function onSend() {
    setSendError(null);
    setSmtpConfigRequired(false);
    start(async () => {
      const r = await sendMail({
        fromIntegrationId: fromId,
        mode,
        ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
        ...(replyTo?.externalId ? { replyToExternalId: replyTo.externalId } : {}),
        toRecipients: [...toList].filter(isValidEmail),
        ccRecipients: [...ccList].filter(isValidEmail),
        bccRecipients: [...bccList].filter(isValidEmail),
        subject,
        bodyHtml,
        composeAttachments: toAttachmentDraftPayload(uploader.items),
      });
      if (r.ok) {
        close();
        notify({ tone: 'success', message: 'Mail envoyé ✓' });
      } else if (r.code === 'SMTP_NOT_CONFIGURED') {
        setSmtpConfigRequired(true);
      } else {
        const message = attachmentFailureCopy(r.code) ?? r.message;
        setSendError(`${r.code}${message ? `: ${message}` : ''}`);
        notify({
          tone: 'error',
          message: `Échec de l'envoi${message ? ` : ${message}` : ''}`,
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
      toRecipients: [...toList],
      ccRecipients: [...ccList],
      bccRecipients: [...bccList],
      subject,
      bodyHtml,
      composeAttachments: toAttachmentDraftPayload(uploader.items),
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
        <RecipientField label="À" value={toList} onChange={setToList} placeholder="Destinataires" />
        <RecipientField label="Cc" value={ccList} onChange={setCcList} placeholder="Cc" />
        <RecipientField label="Cci" value={bccList} onChange={setBccList} placeholder="Cci" />
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Objet"
          className="mb-2 w-full rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm font-medium"
        />
        <RichTextEditor value={bodyHtml} onChange={setBodyHtml} minHeight={200} />
        {forwardLoading ? (
          <p
            className="mt-2 text-xs text-[color:var(--color-text-muted)]"
            role="status"
            aria-live="polite"
          >
            Chargement des pièces jointes originales…
          </p>
        ) : null}
        <AttachmentDrop
          items={uploader.items}
          totalBytes={uploader.totalBytes}
          disabled={pending}
          onDrop={async (files) => {
            const res = await uploader.addFiles(files);
            if (res.capRejected > 0) {
              notify({
                tone: 'error',
                message: 'Vous avez atteint la limite de 20 pièces jointes.',
              });
            }
          }}
          onRemove={(id) => {
            uploader.removeItem(id);
            void removeAttachmentFromDraft({ attachmentDraftId: id });
          }}
        />
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
              disabled={
                pending ||
                toList.length === 0 ||
                !subject ||
                uploader.items.some((x) => x.state === 'uploading')
              }
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
