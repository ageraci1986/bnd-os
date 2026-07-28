'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { parseWidgetData } from './parse-widget-data';
import type { WidgetActions } from './index';
import { RecipientField } from '@/features/communications/components/recipient-field';
import { saveDraft } from '@/features/communications/actions/mail-drafts';

/**
 * Les 4 valeurs de `DraftDto.kind` (mail-drafts.ts). `create_mail_draft`
 * n'émet jamais que `'new_mail'`, `prepare_reply_draft` que `'reply'` — le
 * schéma reste tolérant aux 4 valeurs pour ne jamais planter silencieusement
 * si ce widget est un jour réutilisé pour une sortie `'reply_all'`/`'forward'`.
 */
const kindSchema = z.enum(['reply', 'reply_all', 'forward', 'new_mail']);
type DraftKind = z.infer<typeof kindSchema>;

const KIND_LABELS: Record<DraftKind, string> = {
  reply: 'Réponse',
  reply_all: 'Réponse à tous',
  forward: 'Transfert',
  new_mail: 'Nouveau mail',
};

/**
 * Sortie structurée de `create_mail_draft`/`prepare_reply_draft`
 * (mail-tools.ts) — extras tolérés (ex. `draftSaved`, `updatedAt` : ce widget
 * n'en a pas besoin, le jeton de fraîcheur `send_draft` est géré côté modèle
 * via le prompt, pas ici — voir mail-tools.ts).
 */
const MailDraftDataSchema = z.object({
  kind: kindSchema,
  to: z.array(z.string()),
  cc: z.array(z.string()).default([]),
  bcc: z.array(z.string()).default([]),
  subject: z.string(),
  bodyText: z.string(),
  replyToId: z.string().nullable().default(null),
  fromIntegrationId: z.string(),
});

export interface MailDraftWidgetProps {
  readonly data: unknown;
  /**
   * Nom du tool d'origine — uniquement pour l'étiquette du warn de parse
   * (`parseWidgetData`). `prepare_reply_draft` est passé explicitement par
   * le dispatcher (voir `index.tsx`) ; `create_mail_draft` est le défaut.
   */
  readonly tool?: string;
  /**
   * Sans `actions` : widget en lecture seule — pas d'autosave, pas de
   * boutons. Avec `actions` : édition + autosave debouncé + Envoyer/Garder.
   */
  readonly actions?: WidgetActions;
}

/** Délai d'autosave après la dernière édition (À/Cc/Cci/Objet/Corps). */
const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * Message injecté dans le chat par le bouton Envoyer — verbe fixe, aucun
 * contenu du brouillon (même garde anti-injection que `MailListWidget` :
 * seul un ordre neutre part, jamais l'objet ni le corps). Le modèle relit le
 * brouillon persisté via `get_draft`/`send_draft` — jamais ce texte comme
 * source du contenu envoyé.
 */
const SEND_DRAFT_MESSAGE = 'Envoie le brouillon actuel (send_draft)';

const KEEP_DRAFT_NOTE = 'Sauvegardé — retrouvable dans Communications.';

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

function saveStatusLabel(status: SaveStatus): string | null {
  switch (status) {
    case 'dirty':
    case 'saving':
      return '…';
    case 'saved':
      return '✓ sauvegardé';
    case 'error':
      return 'échec de sauvegarde';
    case 'idle':
      return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Convertit le texte brut de la textarea en HTML pour `saveDraft` —
 * TOUJOURS par échappement intégral (jamais de HTML utilisateur interprété
 * ni injecté : cette fonction ne fait que produire une chaîne, ce widget
 * n'utilise `dangerouslySetInnerHTML` nulle part). Paragraphes séparés par
 * une ligne vide → `<p>`, retours à la ligne simples → `<br>`.
 */
export function textToDraftHtml(text: string): string {
  if (text.trim() === '') return '<p><br></p>';
  return text
    .split('\n\n')
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

/**
 * Brouillon éditable autosauvé dans le fil (Plan 5c Task 6) — rendu pour
 * `create_mail_draft`/`prepare_reply_draft`. À/Cc/Cci via `RecipientField`
 * (chips), objet et corps texte simple ; toute édition programme un autosave
 * debouncé 1800ms→2000ms (`saveDraft`, un seul brouillon par utilisateur).
 * `kind`/`replyToId`/`fromIntegrationId` viennent de la sortie du tool et ne
 * sont jamais édités ici.
 *
 * Envoyer/Garder en brouillon FLUSHENT d'abord l'autosave en attente ou en
 * vol (`flush()`) avant d'agir, pour que ce que l'utilisateur voit soit bien
 * ce qui part : l'envoi réel passe par `sendMessage` → le modèle relit
 * `get_draft` puis appelle `send_draft` avec le jeton de fraîcheur
 * (`expectedUpdatedAt`, mail-tools.ts) — ce widget n'a pas besoin de le
 * connaître.
 */
export function MailDraftWidget({
  data,
  tool = 'create_mail_draft',
  actions,
}: MailDraftWidgetProps) {
  const parsed = parseWidgetData(tool, MailDraftDataSchema, data);

  const [to, setTo] = useState<readonly string[]>(parsed?.to ?? []);
  const [cc, setCc] = useState<readonly string[]>(parsed?.cc ?? []);
  const [bcc, setBcc] = useState<readonly string[]>(parsed?.bcc ?? []);
  const [subject, setSubject] = useState(parsed?.subject ?? '');
  const [bodyText, setBodyText] = useState(parsed?.bodyText ?? '');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [note, setNote] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true entre une édition et le moment où `runSave` démarre réellement
  // l'appel réseau — `flush()` s'appuie dessus pour savoir s'il doit
  // déclencher un save immédiat plutôt qu'attendre un save déjà en vol.
  const pendingRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Le premier effet suit le montage (données initiales) — pas une édition
  // utilisateur, donc pas d'autosave à ce moment-là.
  const skipFirstRef = useRef(true);

  function runSave(): Promise<void> {
    pendingRef.current = false;
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setSaveStatus('saving');
    const promise = (async () => {
      if (parsed === null) return;
      const payload = {
        fromIntegrationId: parsed.fromIntegrationId,
        kind: parsed.kind,
        ...(parsed.replyToId !== null ? { replyToId: parsed.replyToId } : {}),
        toRecipients: [...to],
        ccRecipients: [...cc],
        bccRecipients: [...bcc],
        subject,
        bodyHtml: textToDraftHtml(bodyText),
      };
      try {
        const res = await saveDraft(payload);
        setSaveStatus(res.ok ? 'saved' : 'error');
      } catch {
        setSaveStatus('error');
      }
    })();
    inFlightRef.current = promise;
    void promise.finally(() => {
      inFlightRef.current = null;
    });
    return promise;
  }

  // Autosave debouncé : toute édition (re)programme un unique timer — seule
  // la dernière frappe dans la fenêtre de 2000ms déclenche réellement l'appel.
  useEffect(() => {
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    if (parsed === null) return;
    pendingRef.current = true;
    setSaveStatus('dirty');
    setNote(null);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void runSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [to, cc, bcc, subject, bodyText]);

  // Nettoyage du timer au démontage — évite un setState après unmount.
  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    },
    [],
  );

  /**
   * Garantit qu'aucune édition en attente (debounce non déclenché) ni save
   * en vol ne subsiste avant d'agir (Envoyer/Garder) — ce que l'utilisateur
   * voit à l'écran doit être ce qui est persisté avant que le modèle ne le
   * relise via `get_draft`.
   */
  async function flush(): Promise<void> {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pendingRef.current) {
      await runSave();
      return;
    }
    if (inFlightRef.current !== null) {
      await inFlightRef.current;
    }
  }

  async function handleSend(): Promise<void> {
    await flush();
    actions?.sendMessage(SEND_DRAFT_MESSAGE);
  }

  async function handleKeepDraft(): Promise<void> {
    await flush();
    setNote(KEEP_DRAFT_NOTE);
  }

  if (parsed === null) return null;

  const readOnly = actions === undefined;
  const actionsDisabled = readOnly || actions.busy || saveStatus === 'saving';
  const statusLabel = saveStatusLabel(saveStatus);

  return (
    <div className="w-full rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold text-[color:var(--color-text-main)]">
          ✏️ Brouillon — {KIND_LABELS[parsed.kind]}
        </p>
        {statusLabel !== null && (
          <span
            role="status"
            className={
              saveStatus === 'error'
                ? 'text-[10px] font-semibold text-[color:var(--color-danger)]'
                : 'text-[10px] text-[color:var(--color-text-muted)]'
            }
          >
            {statusLabel}
          </span>
        )}
      </div>

      <RecipientField label="À" value={to} onChange={setTo} disabled={readOnly} />
      <RecipientField label="Cc" value={cc} onChange={setCc} disabled={readOnly} />
      <RecipientField label="Cci" value={bcc} onChange={setBcc} disabled={readOnly} />

      <input
        type="text"
        aria-label="Objet"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={readOnly}
        placeholder="Objet"
        className="mb-2 w-full rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]"
      />

      <textarea
        aria-label="Corps du message"
        value={bodyText}
        onChange={(e) => setBodyText(e.target.value)}
        disabled={readOnly}
        rows={6}
        className="mb-2 w-full resize-y rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]"
      />

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() => void handleSend()}
            className="rounded-full px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
            style={{ background: 'var(--accent-gradient)' }}
          >
            📤 Envoyer
          </button>
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() => void handleKeepDraft()}
            className="rounded-full border border-[color:var(--color-border-light)] px-3 py-1 text-xs font-semibold text-[color:var(--color-text-muted)] disabled:opacity-50"
          >
            💾 Garder en brouillon
          </button>
          <span className="text-[10px] text-[color:var(--color-text-ghost)]">
            éditable ici, ou demandez une retouche dans le chat
          </span>
        </div>
      )}

      {note !== null && (
        <p className="mt-1 text-[10px] text-[color:var(--color-text-muted)]">{note}</p>
      )}
    </div>
  );
}
