'use client';

import { useRef, useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import { formatReceivedAt } from './format-date';
import { parseWidgetData } from './parse-widget-data';
import type { WidgetActions } from './index';
import { fetchMailBody } from '@/features/communications/actions/fetch-mail-body';
import { markEmailRead } from '@/features/communications/actions/mark-email-read';
import { markEmailUnread } from '@/features/communications/actions/mark-email-unread';

/** Nb max de mails affichés (au-delà, la liste est déjà bornée par le tool). */
const MAILS_SHOWN_MAX = 10;

/** Shape produite par le tool `search_mails` (read-tools.ts). Extras tolérés. */
const MailRowSchema = z.object({
  id: z.string(),
  subject: z.string().nullable(),
  fromEmail: z.string(),
  fromName: z.string().nullable(),
  receivedAt: z.string(),
  isRead: z.boolean(),
  folder: z.string(),
  // Utilisé pour le deep-link `?mailbox=<integrationId>&mail=<id>` (Plan 5c
  // Task 3/4). Optionnel : tolérant aux données produites par un tour
  // antérieur à l'ajout de ce champ côté search_mails.
  integrationId: z.string().optional(),
});

/**
 * Deux formes acceptées (Task 5, pagination) :
 * - tableau nu (legacy) : messages déjà commités dans le fil AVANT l'ajout de
 *   l'enveloppe, ou tool antérieur — rendu identique, jamais de pied de page.
 * - enveloppe `{ mails, total, offset }` (search_mails actuel) : `total`
 *   permet d'afficher un pied « N affichés sur total » quand le serveur en
 *   détient plus que ce qui est montré.
 */
const MailListEnvelopeSchema = z.union([
  z.array(MailRowSchema),
  z.object({
    mails: z.array(MailRowSchema),
    total: z.number().optional(),
    offset: z.number().optional(),
  }),
]);

type MailRow = z.infer<typeof MailRowSchema>;

export interface MailListWidgetProps {
  readonly data: unknown;
  /**
   * Canal d'actions (Plan 5c Task 1). Optionnel : sans lui, le widget reste
   * lecture seule — dépli du corps, toggle lu/non-lu et lien profond restent
   * actifs (ils ne dépendent pas du chat), mais les boutons Répondre /
   * Transférer / Archiver / Supprimer et « Tout marquer lu » disparaissent,
   * faute de moyen de les déclencher.
   */
  readonly actions?: WidgetActions;
}

type BodyState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'loaded';
      readonly bodyText: string;
      readonly bodyHtmlSanitized: string | null;
    };

/**
 * Deep-link vers Communications (Plan 5c Task 2) : `mailbox` est optionnel
 * côté page — présent seulement quand le tool a pu résoudre l'intégration
 * source du mail.
 */
function communicationsHref(mail: MailRow): string {
  return mail.integrationId
    ? `/communications?mailbox=${mail.integrationId}&mail=${mail.id}`
    : `/communications?mail=${mail.id}`;
}

/**
 * Classes des pills d'action (maquette `docs/superpowers/specs/assets/
 * 2026-07-28-assistant-v2-widgets-mockup.html`, `.ap-btn`). `--accent-gradient`
 * / `--accent-gradient-soft` sont les tokens design system existants
 * (packages/ui/src/tokens/tokens.css) pour le dégradé de marque — pas de
 * valeur ad hoc réinventée ici.
 */
const PILL_BASE =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold disabled:opacity-50';
const PILL_GRAD = `${PILL_BASE} bg-[image:var(--accent-gradient)] text-white shadow-[0_3px_10px_rgba(139,43,226,0.3)]`;
const PILL_SOFT = `${PILL_BASE} bg-[image:var(--accent-gradient-soft)] text-[color:var(--color-accent-primary)]`;
const PILL_GHOST = `${PILL_BASE} border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)]`;
// `#fecdd3` : pas de token danger « pâle » dans tokens.css (--color-danger-bg
// est plus saturé) — valeur reprise telle quelle de la maquette (`.ap-btn.danger`).
const PILL_DANGER = `${PILL_BASE} border border-[#fecdd3] bg-[color:var(--color-bg-card)] text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-bg)]`;

/** Séparateur vertical entre groupes d'actions (`.ap-open .acts .sep` dans la maquette). */
function ActionsSeparator() {
  return (
    <span
      aria-hidden="true"
      className="mx-0.5 h-4 w-px shrink-0 bg-[color:var(--color-border-soft)]"
    />
  );
}

function renderBody(state: BodyState | undefined) {
  if (state === undefined || state.status === 'loading') {
    return <p className="text-xs text-[color:var(--color-text-muted)]">Chargement du contenu…</p>;
  }
  if (state.status === 'error') {
    return <p className="text-xs text-[color:var(--color-danger)]">{state.message}</p>;
  }
  if (state.bodyHtmlSanitized !== null) {
    return (
      <div
        className="max-h-80 overflow-y-auto text-xs leading-relaxed text-[color:var(--color-text-soft)]"
        // `bodyHtmlSanitized` est assaini côté serveur par l'allowlist partagée
        // (packages/integrations/src/imap/body.ts, action `fetchMailBody`)
        // avant d'être renvoyé — même garantie que `MailReader`
        // (features/communications/components/mail-reader.tsx) : c'est la
        // SEULE valeur jamais injectée ici via `dangerouslySetInnerHTML` —
        // jamais `bodyText` ni une autre source.
        dangerouslySetInnerHTML={{ __html: state.bodyHtmlSanitized }}
      />
    );
  }
  if (state.bodyText.length > 0) {
    return (
      <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-[color:var(--color-text-soft)]">
        {state.bodyText}
      </pre>
    );
  }
  return <p className="text-xs text-[color:var(--color-text-muted)]">(Aucun contenu)</p>;
}

/**
 * Liste de mails pour `search_mails` — client mail embarqué (Plan 5c Task 4) :
 * dépli du corps à la demande (`fetchMailBody`, mis en cache localement),
 * toggle lu/non-lu optimiste, actions Répondre / Transférer / Archiver /
 * Supprimer et « Tout marquer lu » (déléguées au chat via
 * `actions.sendMessage` — jamais exécutées directement ici), et lien profond
 * vers Communications.
 *
 * MANDAT DE SÉCURITÉ : les messages injectés via `sendMessage` ne contiennent
 * QUE des ids et des verbes fixes — jamais l'objet, l'expéditeur ni aucun
 * contenu du mail (un objet malveillant serait sinon promu au statut
 * « parole de l'utilisateur » = injection amplifiée). Les libellés sont
 * pinnés textuellement dans `mail-list-widget.test.tsx`.
 */
export function MailListWidget({ data, actions }: MailListWidgetProps) {
  const parsed = parseWidgetData('search_mails', MailListEnvelopeSchema, data);

  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [bodies, setBodies] = useState<Record<string, BodyState>>({});
  const [readOverrides, setReadOverrides] = useState<Record<string, boolean>>({});
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});
  // Garde synchrone (pas d'attente d'un setState) : évite un double fetch si
  // l'utilisateur re-clique avant la résolution de la première requête.
  const fetchStarted = useRef<Set<string>>(new Set());

  // Liste vide : rien à montrer — le texte du modèle explique déjà l'absence
  // de résultats, un cadre vide n'apporterait que du bruit.
  if (parsed === null) return null;
  const allMails = Array.isArray(parsed) ? parsed : parsed.mails;
  const total = Array.isArray(parsed) ? undefined : parsed.total;
  if (allMails.length === 0) return null;
  const mails = allMails.slice(0, MAILS_SHOWN_MAX);

  function isRead(mail: MailRow): boolean {
    return readOverrides[mail.id] ?? mail.isRead;
  }

  function toggleExpand(mailId: string) {
    setExpandedIds((prev) => ({ ...prev, [mailId]: !prev[mailId] }));
    if (fetchStarted.current.has(mailId)) return;
    fetchStarted.current.add(mailId);
    setBodies((prev) => ({ ...prev, [mailId]: { status: 'loading' } }));
    void fetchMailBody({ emailId: mailId }).then((res) => {
      setBodies((prev) => ({
        ...prev,
        [mailId]: res.ok
          ? { status: 'loaded', bodyText: res.bodyText, bodyHtmlSanitized: res.bodyHtmlSanitized }
          : { status: 'error', message: res.message },
      }));
    });
  }

  function clearRowNote(mailId: string) {
    setRowNotes((prev) => {
      if (!(mailId in prev)) return prev;
      const rest: Record<string, string> = {};
      for (const [id, note] of Object.entries(prev)) {
        if (id !== mailId) rest[id] = note;
      }
      return rest;
    });
  }

  function toggleRead(mail: MailRow) {
    const current = isRead(mail);
    const next = !current;
    setReadOverrides((prev) => ({ ...prev, [mail.id]: next }));
    clearRowNote(mail.id);

    if (next) {
      void markEmailRead({ emailId: mail.id }).then((res) => {
        if (!res.ok) setReadOverrides((prev) => ({ ...prev, [mail.id]: current }));
      });
      return;
    }

    void markEmailUnread({ emailId: mail.id }).then((res) => {
      if (!res.ok) {
        setReadOverrides((prev) => ({ ...prev, [mail.id]: current }));
        return;
      }
      if (res.affected === 0) {
        // `markEmailUnread` délègue au core owner-only : un mail d'une boîte
        // d'un autre membre du workspace renvoie `affected: 0` sans erreur —
        // rollback silencieux + note explicite pour l'utilisateur.
        setReadOverrides((prev) => ({ ...prev, [mail.id]: current }));
        setRowNotes((prev) => ({
          ...prev,
          [mail.id]: "Action ignorée : boîte d'un autre membre.",
        }));
      }
    });
  }

  const unreadShownIds = mails.filter((mail) => !isRead(mail)).map((mail) => mail.id);
  const showMarkAllRead = actions !== undefined && unreadShownIds.length >= 2;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)]">
      <div className="flex items-center gap-2 border-b border-[color:var(--color-border-soft)] px-3.5 py-2.5">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.5px] text-[color:var(--color-text-ghost)]">
          {`✉ ${mails.length} mails — ${unreadShownIds.length} non lus`}
        </span>
        {showMarkAllRead && (
          <button
            type="button"
            disabled={actions.busy}
            onClick={() =>
              actions.sendMessage(`Marque comme lus ces mails : ${unreadShownIds.join(', ')}`)
            }
            className={`${PILL_GHOST} ml-auto`}
          >
            Tout marquer lu
          </button>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-[color:var(--color-border-soft)]">
        {mails.map((mail) => {
          const expanded = expandedIds[mail.id] === true;
          const read = isRead(mail);
          const bodyId = `mail-body-${mail.id}`;
          const note = rowNotes[mail.id];
          // Const local (jamais réassignée) : préserve le narrowing
          // `!== undefined` dans les closures onClick ci-dessous.
          const rowActions = actions;

          return (
            <li key={mail.id}>
              <div className="flex items-center gap-2 px-3.5 py-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={bodyId}
                  onClick={() => toggleExpand(mail.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 bg-transparent text-left"
                >
                  <span
                    aria-label={read ? undefined : 'non lu'}
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background: read
                        ? 'var(--color-border-light)'
                        : 'var(--color-accent-primary)',
                    }}
                  />
                  <span className="w-[104px] shrink-0 truncate text-xs font-bold text-[color:var(--color-text-main)]">
                    {mail.fromName ?? mail.fromEmail}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--color-text-muted)]">
                    {mail.subject ?? '(sans objet)'}
                  </span>
                  <span className="shrink-0 text-[10px] text-[color:var(--color-text-ghost)]">
                    {formatReceivedAt(mail.receivedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={read ? 'Marquer comme non lu' : 'Marquer comme lu'}
                  onClick={() => toggleRead(mail)}
                  className="shrink-0 rounded p-1 text-[10px] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)]"
                >
                  {read ? '●' : '○'}
                </button>
                <Link
                  href={communicationsHref(mail)}
                  className="shrink-0 text-[10px] text-[color:var(--color-text-muted)] no-underline hover:underline"
                >
                  Ouvrir dans Communications
                </Link>
              </div>
              {note !== undefined && (
                <p className="px-3.5 pb-1 text-[10px] text-[color:var(--color-danger)]">{note}</p>
              )}
              {expanded && (
                <div
                  id={bodyId}
                  className="mx-2 mb-2 rounded-xl px-3.5 py-3"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(139,43,226,.025), rgba(255,42,109,.025))',
                  }}
                >
                  <div className="flex items-center gap-2 pb-1">
                    <span className="text-xs font-extrabold text-[color:var(--color-text-main)]">
                      {mail.fromName ?? mail.fromEmail}
                    </span>
                    {mail.fromName !== null && (
                      <span className="text-[10.5px] text-[color:var(--color-text-ghost)]">
                        {mail.fromEmail}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-[color:var(--color-text-ghost)]">
                      {formatReceivedAt(mail.receivedAt)}
                    </span>
                  </div>
                  <div className="py-1">{renderBody(bodies[mail.id])}</div>
                  {rowActions !== undefined && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        disabled={rowActions.busy}
                        onClick={() =>
                          rowActions.sendMessage(`Prépare une réponse au mail ${mail.id}`)
                        }
                        className={PILL_GRAD}
                      >
                        ↩ Répondre
                      </button>
                      <button
                        type="button"
                        disabled={rowActions.busy}
                        onClick={() =>
                          rowActions.sendMessage(`Prépare un transfert du mail ${mail.id}`)
                        }
                        className={PILL_SOFT}
                      >
                        ⇥ Transférer
                      </button>
                      <ActionsSeparator />
                      <button type="button" onClick={() => toggleRead(mail)} className={PILL_GHOST}>
                        {read ? '● Lu' : '◌ Non-lu'}
                      </button>
                      <button
                        type="button"
                        disabled={rowActions.busy}
                        onClick={() => rowActions.sendMessage(`Archive le mail ${mail.id}`)}
                        className={PILL_GHOST}
                      >
                        🗂 Archiver ⚡
                      </button>
                      <button
                        type="button"
                        disabled={rowActions.busy}
                        onClick={() => rowActions.sendMessage(`Supprime le mail ${mail.id}`)}
                        className={PILL_DANGER}
                      >
                        🗑 Supprimer ⚡
                      </button>
                      <ActionsSeparator />
                      <Link href={communicationsHref(mail)} className={PILL_GHOST}>
                        ↗ Ouvrir dans Communications
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {total !== undefined && total > mails.length && (
        <div className="border-t border-[color:var(--color-border-soft)] px-3.5 py-1.5 text-[10px] text-[color:var(--color-text-ghost)]">
          {`${mails.length} affichés sur ${total}`}
        </div>
      )}
    </div>
  );
}
