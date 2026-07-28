'use client';

import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { parseSseLines, type StreamWidget } from '../lib/sse';
import { renderWidget } from './widgets';
import { appendWidget } from './widgets/dedupe-widgets';
import { trimWidgetData } from './widgets/trim-widget-data';

interface DisplayMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** Widgets accumulés pendant le tour qui a produit ce message — jamais renvoyés au serveur. */
  readonly widgets?: readonly StreamWidget[];
}

interface AssistantChatProps {
  readonly csrfToken: string;
  readonly firstName: string;
}

const ACTIVITY_LABELS: Record<string, string> = {
  get_today_overview: 'prépare votre briefing…',
  list_projects: 'consulte les projets…',
  get_project_board: 'consulte le Kanban…',
  list_clients: 'consulte les clients…',
  search_mails: 'cherche dans les mails…',
  read_mail: 'lit un mail…',
  get_current_datetime: 'vérifie la date…',
};

/** Libellé FR du dialog de confirmation, par nom de tool. Repli : le nom brut du tool. */
const CONFIRM_TOOL_LABELS: Record<string, string> = {
  delete_card: 'Suppression de carte',
  send_mail: 'Envoi de mail',
  delete_project: 'Suppression de projet',
  delete_column: 'Suppression de colonne',
};

/** Marge sous la limite serveur de 40 messages (ChatRequestSchema `.max(40)`). */
const HISTORY_MAX = 38;

/**
 * Borne du fil AFFICHÉ (bulles + widgets attachés) — indépendante de
 * `HISTORY_MAX` : sans elle, une longue session accumulerait indéfiniment
 * messages et données de widgets en mémoire.
 */
const DISPLAY_MAX = 80;

export function AssistantChat({ csrfToken, firstName }: AssistantChatProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streamText, setStreamText] = useState<string | null>(null);
  const [streamWidgets, setStreamWidgets] = useState<StreamWidget[]>([]);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    id: string;
    tool: string;
    description: string;
  } | null>(null);
  // Verrou anti double-envoi : mémorise quel bouton a été cliqué, désactive les deux.
  const [answering, setAnswering] = useState<'allow' | 'deny' | null>(null);
  const historyRef = useRef<DisplayMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const allowRef = useRef<HTMLButtonElement | null>(null);
  const denyRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const confirmWasOpen = useRef(false);
  const escNoteId = useId();

  // Annule la requête en cours au démontage (navigation) — silencieux côté UI.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Gestion du focus (WCAG AA) : à l'ouverture du dialog, focus sur Refuser
  // (défaut sûr pour une action destructive) ; à sa fermeture, retour au champ
  // de saisie — une fois le stream terminé, car un input `disabled` ne peut pas
  // recevoir le focus.
  useEffect(() => {
    if (pendingConfirm !== null) {
      confirmWasOpen.current = true;
      denyRef.current?.focus();
      return;
    }
    if (confirmWasOpen.current && !busy) {
      confirmWasOpen.current = false;
      inputRef.current?.focus();
    }
  }, [pendingConfirm, busy]);

  useEffect(() => {
    // Ne recolle en bas que si l'utilisateur y était déjà — laisse la lecture
    // d'un historique remonté tranquille pendant un stream en cours.
    const list = listRef.current;
    if (list === null) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (nearBottom) {
      // `?.` sur la méthode : jsdom ne l'implémente pas.
      bottomRef.current?.scrollIntoView?.({ block: 'end' });
    }
  }, [messages, streamText, streamWidgets, pendingConfirm]);

  const answerConfirm = useCallback(
    async (id: string, allowed: boolean) => {
      setAnswering(allowed ? 'allow' : 'deny');
      try {
        const res = await fetch('/api/assistant/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({ id, allowed }),
        });
        // Le dialog se ferme à la réception de confirm_resolved (source de vérité serveur).
        if (!res.ok) {
          // 404/409 : course avec le timeout serveur (voir confirm-store) — le
          // dialog est déjà résolu ou en passe de l'être, rien à signaler.
          if (res.status === 404 || res.status === 409) return;
          setError('Impossible de transmettre la réponse — réessayez.');
          setAnswering(null); // déverrouille pour permettre un nouvel essai
        }
      } catch {
        setError('Impossible de transmettre la réponse — réessayez.');
        setAnswering(null);
      }
    },
    [csrfToken],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (text === '' || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setStreamText('');
    setStreamWidgets([]);

    const controller = new AbortController();
    abortRef.current = controller;

    /**
     * Commit l'échange (question + réponse, même partielle) en bornant
     * l'historique. Les widgets accumulés pendant le tour sont attachés au
     * message affiché mais JAMAIS à `historyRef` — le payload renvoyé au
     * serveur reste texte-only (invariant CLAUDE.md §4.5 : pas de JSON
     * arbitraire de tool dans le prompt suivant).
     */
    const commit = (assistantText: string, widgets: readonly StreamWidget[]): void => {
      const next: DisplayMessage[] = [
        ...historyRef.current,
        { role: 'user', content: text },
        { role: 'assistant', content: assistantText },
      ];
      historyRef.current = next.slice(-HISTORY_MAX);
      setMessages((prev) =>
        [
          ...prev,
          {
            role: 'assistant' as const,
            content: assistantText,
            ...(widgets.length > 0 ? { widgets } : {}),
          },
        ].slice(-DISPLAY_MAX),
      );
    };

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    // Accumulé dans une variable locale (pas seulement en state) pour que les
    // chemins d'erreur / fermeture sans `done` conservent la réponse partielle.
    let accumulated = '';
    let finalText = '';
    // Idem pour les widgets : variable locale à jour de façon synchrone dans
    // la boucle de lecture, utilisée par `commit()` sans dépendre du state.
    let widgets: StreamWidget[] = [];
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ messages: historyRef.current.slice(-HISTORY_MAX), message: text }),
        signal: controller.signal,
      });
      if (!res.ok || res.body === null) {
        const payload = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(payload?.message ?? 'Une erreur est survenue — réessayez.');
        return;
      }
      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseLines(buffer);
        buffer = rest;
        for (const event of events) {
          if (event.type === 'chunk') {
            accumulated += event.text;
            setStreamText(accumulated);
          }
          if (event.type === 'tool_start') setActivity(ACTIVITY_LABELS[event.name] ?? 'travaille…');
          if (event.type === 'tool_end') setActivity(null);
          if (event.type === 'tool_result') {
            // Trim à la réception : borne aussi bien l'état de stream que la
            // donnée conservée sur le message commité (ex. board 100 cartes/colonne).
            // appendWidget garantit aussi qu'un seul board par projet reste
            // affiché — un board périmé ne doit jamais contredire le texte
            // de l'agent après une mutation (spec V2 §3.2).
            widgets = appendWidget(widgets, {
              tool: event.tool,
              data: trimWidgetData(event.tool, event.data),
            });
            setStreamWidgets(widgets);
          }
          if (event.type === 'confirm_request') {
            setPendingConfirm({ id: event.id, tool: event.tool, description: event.description });
            setAnswering(null);
          }
          if (event.type === 'confirm_resolved') {
            setPendingConfirm(null);
            setAnswering(null);
          }
          if (event.type === 'done') finalText = event.text;
          if (event.type === 'error') setError(event.message);
        }
      }
      // Flux terminé sans `done` (erreur mi-parcours, coupure serveur) : on
      // conserve la réponse partielle plutôt que de jeter les tokens reçus.
      const answer = finalText !== '' ? finalText : accumulated;
      if (answer !== '') commit(answer, widgets);
    } catch (err) {
      if (reader !== null) void reader.cancel().catch(() => undefined);
      const isAbort = (err as { name?: string } | null)?.name === 'AbortError';
      if (!isAbort) {
        if (accumulated !== '') commit(accumulated, widgets);
        setError('Connexion interrompue — réessayez.');
      }
    } finally {
      abortRef.current = null;
      setStreamText(null);
      setStreamWidgets([]);
      setActivity(null);
      // Flux terminé sans confirm_resolved (coupure, erreur) : plus aucun serveur
      // n'attend la réponse — un dialog restant serait du bruit (clic → 404 muet).
      setPendingConfirm(null);
      setAnswering(null);
      setBusy(false);
    }
  }, [busy, csrfToken, input]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center gap-4 px-6 py-8">
      {/* Placeholder orbe — remplacé par le blob animé au Plan 4 */}
      <div
        aria-hidden
        className="h-20 w-20 rounded-full"
        style={{
          background: 'var(--accent-gradient)',
          boxShadow: '0 14px 40px rgba(139,43,226,.32)',
        }}
      />
      <h1 className="text-lg font-bold text-[color:var(--color-text-main)]">
        Bonjour {firstName} 👋
      </h1>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Demandez votre briefing, interrogez vos projets et vos mails.
      </p>

      <div ref={listRef} className="flex w-full flex-1 flex-col gap-2 overflow-y-auto">
        {/* Seul le texte commité est annoncé (région live par bulle) : la réponse
            finale est lue une fois, sans spammer les lecteurs d'écran à chaque
            chunk streamé. Les widgets restent HORS de toute région live — un
            board ou une liste de mails serait lu ligne à ligne alors que le
            texte de l'assistant porte déjà l'information ; leurs liens restent
            pleinement accessibles (pas d'aria-hidden). */}
        <div className="flex flex-col gap-2">
          {messages.map((m, i) => (
            <Fragment key={i}>
              <div className="flex flex-col" aria-live="polite">
                <div
                  className={
                    m.role === 'user'
                      ? 'self-end rounded-2xl px-4 py-2 text-sm text-white'
                      : 'self-start rounded-2xl border border-[color:var(--color-border-soft)] bg-[color:var(--color-bg-card)] px-4 py-2 text-sm text-[color:var(--color-text-soft)]'
                  }
                  style={m.role === 'user' ? { background: 'var(--accent-gradient)' } : undefined}
                >
                  {m.content}
                </div>
              </div>
              {/* Widgets rendus pleine largeur sous la bulle, pas dedans — plus
                  lisible pour un mini-Kanban ou une liste de mails. */}
              {m.widgets?.map((w, wi) => (
                <Fragment key={wi}>{renderWidget(w.tool, w.data)}</Fragment>
              ))}
            </Fragment>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {streamText !== null && streamText !== '' && (
            <div className="self-start rounded-2xl border border-[color:var(--color-border-soft)] bg-[color:var(--color-bg-card)] px-4 py-2 text-sm text-[color:var(--color-text-soft)]">
              {streamText}
            </div>
          )}
          {streamWidgets.map((w, wi) => (
            <Fragment key={wi}>{renderWidget(w.tool, w.data)}</Fragment>
          ))}
          {activity !== null && (
            <p className="text-xs font-semibold text-[color:var(--color-text-ghost)]">{activity}</p>
          )}
          {pendingConfirm !== null && (
            <div
              role="alertdialog"
              aria-label="Confirmation requise"
              aria-describedby={escNoteId}
              className="w-full self-start rounded-2xl border-2 px-4 py-3 text-sm"
              style={{ borderColor: 'var(--accent-primary)', background: 'var(--color-bg-card)' }}
              onKeyDown={(e) => {
                // Piège de focus minimal : Tab / Maj+Tab cyclent entre les deux
                // boutons ; Échap est neutralisé — le refus doit être explicite.
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const target =
                    document.activeElement === denyRef.current ? allowRef.current : denyRef.current;
                  target?.focus();
                }
                if (e.key === 'Escape') e.preventDefault();
              }}
            >
              <p
                className="text-xs font-bold uppercase tracking-wide"
                style={{ color: 'var(--accent-primary)' }}
              >
                ⚡ Confirmation — {CONFIRM_TOOL_LABELS[pendingConfirm.tool] ?? pendingConfirm.tool}
              </p>
              <p className="mt-1 break-words text-[color:var(--color-text-main)]">
                {pendingConfirm.description}
              </p>
              <p id={escNoteId} className="sr-only">
                La touche Échap ne ferme pas cette demande — répondez avec Autoriser ou Refuser.
                Sans réponse, elle sera refusée automatiquement.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  ref={allowRef}
                  type="button"
                  className="rounded-full px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: 'var(--accent-gradient)' }}
                  disabled={answering !== null}
                  onClick={() => void answerConfirm(pendingConfirm.id, true)}
                >
                  {answering === 'allow' ? 'envoi…' : 'Autoriser'}
                </button>
                <button
                  ref={denyRef}
                  type="button"
                  className="rounded-full border border-[color:var(--color-border-light)] px-4 py-1.5 text-xs font-bold text-[color:var(--color-text-muted)] disabled:opacity-50"
                  disabled={answering !== null}
                  onClick={() => void answerConfirm(pendingConfirm.id, false)}
                >
                  {answering === 'deny' ? 'envoi…' : 'Refuser'}
                </button>
                <span className="ml-auto self-center text-xs text-[color:var(--color-text-ghost)]">
                  refusée automatiquement après 2 min sans réponse
                </span>
              </div>
            </div>
          )}
        </div>
        {error !== null && (
          <p role="alert" className="text-sm text-[color:var(--color-danger)]">
            {error}
          </p>
        )}
        <div ref={bottomRef} aria-hidden />
      </div>

      <form
        className="flex w-full items-center gap-2 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={inputRef}
          className="flex-1 bg-transparent text-sm text-[color:var(--color-text-main)] outline-none"
          placeholder="Demandez quelque chose, ou dictez une série d'actions…"
          aria-label="Message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button
          type="button"
          className="h-8 w-8 rounded-full bg-[color:var(--color-bg-hover)] text-sm opacity-45"
          title="Voix — bientôt"
          aria-label="Voix — bientôt"
          disabled
        >
          🎙
        </button>
        <button
          type="submit"
          className="h-8 w-8 rounded-full text-sm text-white disabled:opacity-50"
          style={{ background: 'var(--accent-gradient)' }}
          aria-label="Envoyer"
          disabled={busy || input.trim() === ''}
        >
          ➤
        </button>
      </form>
    </div>
  );
}
