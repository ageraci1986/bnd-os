'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { parseWidgetData } from './parse-widget-data';
import type { WidgetActions } from './index';
import { RecipientField } from '@/features/communications/components/recipient-field';
import { loadDraft, saveDraft, type DraftDto } from '@/features/communications/actions/mail-drafts';

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
 * (mail-tools.ts) — extras tolérés. Elle ne sert que de DÉCLENCHEUR et
 * d'aperçu pendant le chargement : la source de vérité éditée par ce widget
 * est le brouillon persisté relu via `loadDraft()` au montage (revue C1).
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

/** Délai d'autosave après la dernière édition (À/Cc/Cci/Objet/Corps) : 2000 ms. */
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
const KEEP_FAILED_NOTE = 'Échec de sauvegarde — le brouillon n’a pas été mis à jour.';
const SEND_BLOCKED_NOTE = 'Envoi bloqué : la sauvegarde du brouillon a échoué — réessayez.';
const LOAD_FAILED_NOTE =
  'Impossible de charger le brouillon — ouvrez Communications pour l’éditer.';
const DRAFT_GONE_NOTE = 'Aucun brouillon en base — il a peut-être déjà été envoyé ou supprimé.';
const LOADING_LABEL = 'Chargement du brouillon…';

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

/** Texte d'un nœud : récursif, `<br>` → `\n`, autres balises aplaties (inline). */
function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  if (el.tagName === 'BR') return '\n';
  let out = '';
  el.childNodes.forEach((child) => {
    out += nodeText(child);
  });
  return out;
}

/**
 * Conversion FIDÈLE bodyHtml → texte éditable, CÔTÉ CLIENT via `DOMParser`
 * (revue C1) : `parseFromString` construit un document inerte — il ne charge
 * aucune ressource et n'exécute aucun script. Blocs `<p>`/`<div>` → séparés
 * par une ligne vide, `<br>` → saut de ligne, entités décodées UNE fois par
 * le DOM. Pas de troncature : c'est l'éditeur du contenu réel du brouillon.
 * Round-trip stable avec `textToDraftHtml` (pinné en test — pas de
 * double-échappement).
 */
export function draftHtmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: string[] = [];
  let current = '';
  doc.body.childNodes.forEach((node) => {
    const isBlock =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as Element).tagName === 'P' || (node as Element).tagName === 'DIV');
    if (isBlock) {
      if (current !== '') {
        blocks.push(current);
        current = '';
      }
      blocks.push(nodeText(node));
    } else {
      current += nodeText(node);
    }
  });
  if (current !== '') blocks.push(current);
  return blocks.join('\n\n');
}

/** État éditable du formulaire — seedé depuis le `DraftDto` chargé, jamais depuis le JSON du tool. */
interface FormState {
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly subject: string;
  readonly bodyText: string;
  /** True dès que la textarea a été touchée — sinon l'autosave renvoie le bodyHtml canonique inchangé. */
  readonly bodyDirty: boolean;
}

type Phase = 'loading' | 'unavailable' | 'ready';

/**
 * Brouillon éditable autosauvé dans le fil (Plan 5c Task 6, revu C1) —
 * rendu pour `create_mail_draft`/`prepare_reply_draft`.
 *
 * ÉDITEUR LIVE du brouillon DB : au montage, le widget recharge le brouillon
 * persisté via `loadDraft()` (Server Action — c'est le brouillon de
 * l'utilisateur, son client peut voir son bodyHtml ; l'interdit du HTML brut
 * ne vaut que pour le MODÈLE, cf. mail-tools.ts) et seede TOUS les champs
 * depuis le `DraftDto` (to/cc/bcc/subject/kind/replyToId/fromIntegrationId/
 * composeAttachments/bodyHtml). Le JSON du tool ne sert que de déclencheur
 * et d'aperçu pendant le chargement. Plusieurs widgets draft dans le fil
 * (ex. messages successifs) sont donc plusieurs VUES du MÊME brouillon —
 * chacune re-seedée à son montage ; la clé de rendu inclut `data.updatedAt`
 * (assistant-chat.tsx) pour forcer un remount/re-seed quand la dédup
 * remplace un widget draft par un plus frais.
 *
 * Autosave : debounce 2000 ms après toute édition ; le payload part de
 * l'état édité + les `composeAttachments` CANONIQUES chargés (jamais
 * écrasés — revue I2) ; corps non touché → bodyHtml canonique renvoyé tel
 * quel (pas de reconversion destructrice). Les saves sont SÉRIALISÉS
 * (revue I4) : chaque save chaîne sur le précédent, jamais deux upserts
 * concurrents. Envoyer/Garder FLUSHENT d'abord (édition en attente ou save
 * en vol) et l'échec du flush BLOQUE l'envoi (revue I1) — ce que
 * l'utilisateur voit doit être persisté avant que le modèle ne le relise
 * via `get_draft`/`send_draft`.
 */
export function MailDraftWidget({
  data,
  tool = 'create_mail_draft',
  actions,
}: MailDraftWidgetProps) {
  const parsed = parseWidgetData(tool, MailDraftDataSchema, data);

  const [phase, setPhase] = useState<Phase>('loading');
  const [form, setForm] = useState<FormState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [note, setNote] = useState<string | null>(null);

  /** Brouillon canonique chargé au montage — source des champs non édités ici (kind, replyToId, fromIntegrationId, composeAttachments, bodyHtml intact). */
  const canonicalRef = useRef<DraftDto | null>(null);
  /** Miroir synchrone de `form` — lu par les saves (pas de closure périmée). */
  const formRef = useRef<FormState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True entre une édition et le démarrage du save — `flush()` sait qu'un save immédiat est dû. */
  const pendingRef = useRef(false);
  /** Chaîne des saves en cours (revue I4) — chaque nouveau save s'y chaîne, `flush()` l'attend en entier. */
  const inFlightRef = useRef<Promise<boolean> | null>(null);

  // Seed au montage : le brouillon DB fait foi. `parsed` capturé au premier
  // rendu (deps []) — `data` est constant pour une instance de widget.
  useEffect(() => {
    if (parsed === null) return;
    let cancelled = false;
    loadDraft()
      .then(({ draft }) => {
        if (cancelled) return;
        if (draft === null) {
          setPhase('unavailable');
          setNote(DRAFT_GONE_NOTE);
          return;
        }
        canonicalRef.current = draft;
        const seeded: FormState = {
          to: draft.toRecipients,
          cc: draft.ccRecipients,
          bcc: draft.bccRecipients,
          subject: draft.subject,
          bodyText: draftHtmlToText(draft.bodyHtml),
          bodyDirty: false,
        };
        formRef.current = seeded;
        setForm(seeded);
        setPhase('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setPhase('unavailable');
        setNote(LOAD_FAILED_NOTE);
      });
    return () => {
      cancelled = true;
    };
    // Montage uniquement (deps vides à dessein) — le re-seed passe par un
    // remount (clé updatedAt, voir widgetKey dans assistant-chat.tsx).
  }, []);

  // Nettoyage du timer au démontage — évite un setState après unmount.
  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    },
    [],
  );

  /**
   * Exécute (ou chaîne) un save : lit l'état ÉDITÉ via `formRef` au moment
   * où le save démarre réellement, jamais une closure périmée. Sérialisé :
   * chaîné sur `inFlightRef` — jamais deux upserts concurrents (revue I4).
   * Renvoie `true` si CE save a réussi (revue I1 — flush honnête).
   */
  function runSave(): Promise<boolean> {
    pendingRef.current = false;
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setSaveStatus('saving');
    const chained = (inFlightRef.current ?? Promise.resolve(true)).then(
      async (): Promise<boolean> => {
        const f = formRef.current;
        const canonical = canonicalRef.current;
        if (f === null || canonical === null) return false;
        try {
          const res = await saveDraft({
            fromIntegrationId: canonical.fromIntegrationId,
            kind: canonical.kind,
            ...(canonical.replyToId !== null ? { replyToId: canonical.replyToId } : {}),
            toRecipients: [...f.to],
            ccRecipients: [...f.cc],
            bccRecipients: [...f.bcc],
            subject: f.subject,
            // Corps non touché → bodyHtml canonique inchangé (pas de
            // reconversion qui aplatirait un HTML riche) ; touché → HTML
            // reconstruit par échappement depuis la textarea.
            bodyHtml: f.bodyDirty ? textToDraftHtml(f.bodyText) : canonical.bodyHtml,
            // Toujours la valeur CANONIQUE chargée — l'autosave du widget ne
            // touche jamais aux pièces jointes (revue I2).
            composeAttachments: [...canonical.composeAttachments],
          });
          if (!res.ok) {
            // Ré-arme le retry (re-revue I1) : sans ça, `pendingRef` remis à
            // false au départ de ce save + `inFlightRef` vidé au finally
            // feraient répondre `true` au prochain flush() SANS réédition —
            // Envoyer partirait avec un brouillon DB périmé et « Garder »
            // afficherait « Sauvegardé… » à tort. Le prochain flush (Envoyer/
            // Garder) ou le prochain autosave RETENTE le save.
            pendingRef.current = true;
          }
          setSaveStatus(res.ok ? 'saved' : 'error');
          return res.ok;
        } catch {
          pendingRef.current = true; // même ré-armement que ok:false ci-dessus
          setSaveStatus('error');
          return false;
        }
      },
    );
    inFlightRef.current = chained;
    void chained.finally(() => {
      if (inFlightRef.current === chained) inFlightRef.current = null;
    });
    return chained;
  }

  function scheduleAutosave(): void {
    pendingRef.current = true;
    setSaveStatus('dirty');
    setNote(null);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void runSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function edit(mutator: (prev: FormState) => FormState): void {
    const prev = formRef.current;
    if (prev === null) return;
    const next = mutator(prev);
    formRef.current = next;
    setForm(next);
    scheduleAutosave();
  }

  /**
   * Garantit qu'aucune édition en attente (debounce non déclenché) ni save
   * en vol ne subsiste avant d'agir (Envoyer/Garder), et REMONTE le succès :
   * `false` si le dernier save a échoué (revue I1).
   */
  async function flush(): Promise<boolean> {
    if (pendingRef.current) return runSave();
    if (inFlightRef.current !== null) return inFlightRef.current;
    return true;
  }

  async function handleSend(): Promise<void> {
    const ok = await flush();
    if (!ok) {
      // Échec de persistance → JAMAIS d'envoi : le brouillon en base ne
      // correspond pas à ce que l'utilisateur voit (revue I1).
      setNote(SEND_BLOCKED_NOTE);
      return;
    }
    actions?.sendMessage(SEND_DRAFT_MESSAGE);
  }

  async function handleKeepDraft(): Promise<void> {
    const ok = await flush();
    setNote(ok ? KEEP_DRAFT_NOTE : KEEP_FAILED_NOTE);
  }

  if (parsed === null) return null;

  // Aperçu (JSON du tool) tant que le brouillon DB n'est pas chargé.
  const view: FormState = form ?? {
    to: parsed.to,
    cc: parsed.cc,
    bcc: parsed.bcc,
    subject: parsed.subject,
    bodyText: parsed.bodyText,
    bodyDirty: false,
  };
  const kind = canonicalRef.current?.kind ?? parsed.kind;

  const editable = phase === 'ready' && actions !== undefined;
  const fieldsDisabled = !editable;
  const buttonsDisabled =
    phase !== 'ready' || actions === undefined || actions.busy || saveStatus === 'saving';
  const statusLabel = phase === 'loading' ? LOADING_LABEL : saveStatusLabel(saveStatus);

  return (
    <div className="w-full rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold text-[color:var(--color-text-main)]">
          ✏️ Brouillon — {KIND_LABELS[kind]}
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

      <RecipientField
        label="À"
        value={view.to}
        onChange={(next) => edit((f) => ({ ...f, to: next }))}
        disabled={fieldsDisabled}
      />
      <RecipientField
        label="Cc"
        value={view.cc}
        onChange={(next) => edit((f) => ({ ...f, cc: next }))}
        disabled={fieldsDisabled}
      />
      <RecipientField
        label="Cci"
        value={view.bcc}
        onChange={(next) => edit((f) => ({ ...f, bcc: next }))}
        disabled={fieldsDisabled}
      />

      <input
        type="text"
        aria-label="Objet"
        value={view.subject}
        onChange={(e) => edit((f) => ({ ...f, subject: e.target.value }))}
        disabled={fieldsDisabled}
        placeholder="Objet"
        className="mb-2 w-full rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]"
      />

      <textarea
        aria-label="Corps du message"
        value={view.bodyText}
        onChange={(e) => edit((f) => ({ ...f, bodyText: e.target.value, bodyDirty: true }))}
        disabled={fieldsDisabled}
        rows={6}
        className="mb-2 w-full resize-y rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]"
      />

      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={buttonsDisabled}
            onClick={() => void handleSend()}
            className="rounded-full px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
            style={{ background: 'var(--accent-gradient)' }}
          >
            📤 Envoyer
          </button>
          <button
            type="button"
            disabled={buttonsDisabled}
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
