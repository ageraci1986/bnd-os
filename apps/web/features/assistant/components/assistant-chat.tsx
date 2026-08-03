'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { matchVoiceConfirm, SentenceChunker } from '@nexushub/agent';
import { briefParts } from '@/lib/assistant/brief-sentence';
import type { TodayOverview } from '@/lib/assistant/overview-core';
import { useVoiceMode } from '../hooks/use-voice-mode';
import { fetchWithCsrfRetry } from '../lib/csrf-retry';
import { parseSseLines, type StreamWidget } from '../lib/sse';
import { AssistantOrb, deriveOrbActivity } from './assistant-orb';
import { NoticeStack, type AgentNotice } from './notice-stack';
import { VoiceCapsule } from './voice-capsule';
import { renderWidget, type WidgetActions } from './widgets';
import { appendWidget } from './widgets/dedupe-widgets';
import { KpiCards } from './widgets/kpi-cards';
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
  /**
   * Résumé du jour chargé côté serveur (Plan 4 Task 3 — zéro tour d'agent,
   * zéro token). Absent si non fourni par la page (accueil dégradé, ex. DB
   * indisponible au chargement) : le brief statique reste affiché.
   */
  readonly overview?: TodayOverview;
  /**
   * Notices proactives non lues (Plan 3b Task 7), chargées côté serveur par
   * la page. Optionnel : absent → pile vide (même dégradation que
   * `overview`, ex. panne DB au chargement de la page).
   */
  readonly notices?: readonly AgentNotice[];
}

/**
 * Phrase digérée de l'accueil, construite depuis `overview` via
 * `briefParts` (accords singulier/pluriel factorisés dans
 * `lib/assistant/brief-sentence.ts` — partagé avec la notice de briefing
 * matinal Inngest, Plan 3b Task 4). La partie « bloquée(s) » n'apparaît que
 * si `blockedCards > 0`, colorée avec le même token danger que `KpiCards`
 * (widgets/kpi-cards.tsx) pour rester cohérente avec le rendu in-thread du
 * même tool (`get_today_overview`).
 */
function DigestedBrief({ overview }: { readonly overview: TodayOverview }) {
  const { task: taskPart, blocked: blockedPart, mail: mailPart } = briefParts(overview);
  return (
    <p data-testid="assistant-brief" className="text-sm text-[color:var(--color-text-muted)]">
      {taskPart}
      {blockedPart !== null && (
        <>
          {' · '}
          <span style={{ color: 'var(--color-danger)' }}>{blockedPart}</span>
        </>
      )}
      {' · '}
      {mailPart}
    </p>
  );
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

/** Tools dont la sortie est rendue par `MailDraftWidget` (voir widgets/index.tsx). */
const DRAFT_WIDGET_TOOLS: ReadonlySet<string> = new Set([
  'create_mail_draft',
  'prepare_reply_draft',
]);

/**
 * Clé de rendu d'un widget dans le fil. Pour les widgets draft, la clé
 * inclut `data.updatedAt` : quand la dédup (`appendWidget`) remplace un
 * widget draft par un plus frais EN PLACE, l'index seul ne changerait pas et
 * React réutiliserait l'instance montée — la clé updatedAt force un
 * remount, donc un re-seed depuis `loadDraft()` (`MailDraftWidget` est un
 * éditeur live du brouillon DB ; plusieurs widgets draft dans le fil sont
 * plusieurs VUES du MÊME brouillon, chacune seedée à son montage).
 */
function widgetKey(widget: StreamWidget, index: number): string {
  if (!DRAFT_WIDGET_TOOLS.has(widget.tool)) return String(index);
  const updatedAt =
    typeof widget.data === 'object' &&
    widget.data !== null &&
    typeof (widget.data as { updatedAt?: unknown }).updatedAt === 'string'
      ? (widget.data as { updatedAt: string }).updatedAt
      : '';
  return `${index}:${widget.tool}:${updatedAt}`;
}

export function AssistantChat({ csrfToken, firstName, overview, notices }: AssistantChatProps) {
  // Recovery CSRF (fetchWithCsrfRetry, voir features/assistant/lib/csrf-retry.ts) :
  // `csrfToken` (prop) n'est que la valeur INITIALE — un onglet /assistant
  // laissé ouvert des heures/jours voit sa valeur remplacée en place quand
  // un appel échoue en 403 "CSRF invalide" (cookie expiré ou tourné par un
  // déploiement) et qu'un jeton frais est réémis par /api/assistant/csrf.
  const [csrf, setCsrf] = useState(csrfToken);
  // Ref miroir de `csrf`, synchronisée à CHAQUE render (même pattern que
  // `inputValueRef` ci-dessous) — `send`/`answerConfirm` la lisent au lieu de
  // dépendre du state `csrf` : sans ça, ces callbacks changeraient d'identité
  // à chaque refresh de token, ce qui casserait le contrat de stabilité de
  // `send` (voir son commentaire de deps plus bas).
  const csrfRef = useRef(csrf);
  csrfRef.current = csrf;
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  // Ref miroir de `input` (Plan 5c Task 6, mandat B) — `send` la lit au lieu
  // de dépendre du state `input` : sans ça, `send` (donc `widgetActions`,
  // memoïsé ci-dessous) changeait d'identité à CHAQUE frappe, ce qui aurait
  // remis à zéro le debounce d'autosave d'un widget comme `MailDraftWidget`
  // si ce dernier utilisait `actions` comme dépendance d'effet. `widgetActions`
  // ne doit changer que sur `busy` (voir aussi `csrfRef` ci-dessus, qui
  // protège `send` d'un refresh de token pour la même raison). Synchronisée
  // dans `onChange` (ci-dessous), jamais via un effet — pas de round-trip
  // de rendu.
  const inputValueRef = useRef('');
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

  // --- Mode voix (V1.5, spec 2026-08-03) -----------------------------------
  // Tour vocal ? → sortie symétrique : le TTS ne lit que les réponses aux
  // questions posées à la voix. Ref (pas state) : lu dans la boucle SSE.
  const voiceTurnRef = useRef(false);
  // Armé par onTranscript juste avant send() — un envoi clavier/widget trouve
  // ce flag à false. Voir le bloc « tour vocal ? » au début de send().
  const nextTurnIsVoiceRef = useRef(false);
  // Chunker du tour en cours — recréé à chaque tour vocal (une instance = un tour).
  const chunkerRef = useRef<SentenceChunker | null>(null);
  const pendingConfirmRef = useRef<{ id: string } | null>(null);
  // Évite le cycle « voice utilisé avant sa déclaration » dans onVoiceConfirm.
  const speakRef = useRef<(s: string) => void>(() => undefined);

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

  const answerConfirm = useCallback(async (id: string, allowed: boolean) => {
    setAnswering(allowed ? 'allow' : 'deny');
    try {
      const res = await fetchWithCsrfRetry(
        '/api/assistant/confirm',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, allowed }),
        },
        () => csrfRef.current,
        setCsrf,
      );
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
  }, []);

  /**
   * `textOverride` (Plan 5c) : canal d'injection utilisé par les widgets
   * (`WidgetActions.sendMessage`) pour envoyer un message comme si
   * l'utilisateur l'avait tapé — MÊME chemin que la saisie manuelle en
   * dessous (mêmes gardes `busy`/texte vide, même historique, même payload).
   * Un override vide/whitespace est ignoré (repli sur `input`) ; un override
   * non vide utilisé NE VIDE PAS le champ de saisie (l'utilisateur peut avoir
   * un brouillon en cours dedans).
   */
  const send = useCallback(
    async (textOverride?: string) => {
      const useOverride = textOverride !== undefined && textOverride.trim() !== '';
      // Lu depuis la ref (pas le state `input`) : `send` reste une fonction
      // stable entre deux frappes — voir le commentaire sur `inputValueRef`.
      const text = (useOverride ? textOverride : inputValueRef.current).trim();
      // Tour vocal ? Armé par onTranscript uniquement (nextTurnIsVoiceRef) —
      // sortie symétrique : les envois clavier/widget restent silencieux.
      // Consommé AVANT le garde busy/vide : un envoi vocal refusé (tour déjà
      // en cours, transcript devenu vide) ne doit jamais laisser le flag armé
      // pour un tour clavier ultérieur.
      const isVoiceTurn = nextTurnIsVoiceRef.current;
      nextTurnIsVoiceRef.current = false;
      if (text === '' || busy) return;
      setBusy(true);
      setError(null);
      if (!useOverride) {
        inputValueRef.current = '';
        setInput('');
      }
      setMessages((prev) => [...prev, { role: 'user', content: text }]);
      setStreamText('');
      setStreamWidgets([]);
      voiceTurnRef.current = isVoiceTurn;
      chunkerRef.current = isVoiceTurn ? new SentenceChunker() : null;

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
      // Un tour normal émet TOUJOURS un événement terminal (`done` ou
      // `error` — voir route.ts) SAUF quand la fonction serverless est tuée
      // (maxDuration Vercel, OOM, redeploy) : le flux se ferme net, sans le
      // dire. Sans ce drapeau, l'UI redevenait idle en silence.
      let sawTerminal = false;
      try {
        const res = await fetchWithCsrfRetry(
          '/api/assistant/chat',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: historyRef.current.slice(-HISTORY_MAX),
              message: text,
            }),
            signal: controller.signal,
          },
          () => csrfRef.current,
          setCsrf,
        );
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
              // Tour vocal : vocaliser les phrases complètes au fil de l'eau.
              if (chunkerRef.current !== null) {
                for (const sentence of chunkerRef.current.push(event.text)) {
                  speakRef.current(sentence);
                }
              }
            }
            if (event.type === 'tool_start')
              setActivity(ACTIVITY_LABELS[event.name] ?? 'travaille…');
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
              // Tour vocal : lire le récapitulatif à voix haute (spec §4.1).
              if (voiceTurnRef.current) speakRef.current(event.description);
            }
            if (event.type === 'confirm_resolved') {
              setPendingConfirm(null);
              setAnswering(null);
            }
            if (event.type === 'done') {
              finalText = event.text;
              sawTerminal = true;
            }
            if (event.type === 'error') {
              setError(event.message);
              sawTerminal = true;
            }
          }
        }
        // Flux terminé sans `done` (erreur mi-parcours, coupure serveur) : on
        // conserve la réponse partielle plutôt que de jeter les tokens reçus.
        const answer = finalText !== '' ? finalText : accumulated;
        if (answer !== '') {
          commit(answer, widgets);
        } else if (widgets.length > 0) {
          // Coupure AVANT le premier chunk de texte (ex. mi-boucle d'outils) :
          // sans ce repli, les widgets déjà reçus (tool_result) seraient
          // purgés en silence par le `finally` ci-dessous (setStreamWidgets([])) —
          // on les commite quand même, avec un texte de repli, plutôt que de
          // les faire disparaître.
          commit(
            '(Réponse interrompue avant le texte final — les éléments ci-dessous ont été conservés.)',
            widgets,
          );
        }
        // Ni `done` ni `error` reçu : le flux s'est arrêté sans le dire (tué
        // par l'infra — maxDuration Vercel 300s, OOM, redeploy). Doit rester
        // silencieux sur un abort utilisateur (catch ci-dessous, AbortError)
        // et ne jamais doubler un message déjà posé par un événement `error`.
        if (!sawTerminal) {
          setError(
            'La réponse a été interrompue (délai dépassé ou coupure serveur) — réessayez ou découpez la demande.',
          );
        }
      } catch (err) {
        if (reader !== null) void reader.cancel().catch(() => undefined);
        const isAbort = (err as { name?: string } | null)?.name === 'AbortError';
        if (!isAbort) {
          if (accumulated !== '') commit(accumulated, widgets);
          setError('Connexion interrompue — réessayez.');
        }
      } finally {
        // Fin de réponse : vocaliser le reliquat sans délimiteur final.
        if (chunkerRef.current !== null) {
          const rest = chunkerRef.current.flush();
          if (rest !== '') speakRef.current(rest);
          chunkerRef.current = null;
        }
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
    },
    // `input` volontairement absent des deps — `send` lit `inputValueRef.current`
    // (toujours à jour, synchronisée par l'onChange du champ) pour rester stable
    // indépendamment de la frappe. Voir le commentaire sur `inputValueRef`.
    // `voice.speak` volontairement absent aussi : `send` est déclaré AVANT le
    // hook voix (`voice` référencerait un identifiant pas encore initialisé
    // dans ce tableau de dépendances — TDZ). `speakRef.current` (toujours à
    // jour, réassigné à chaque render juste après `useVoiceMode`) est lu à la
    // place — même pattern que `inputValueRef`/`propsRef`.
    // `csrf` volontairement absent aussi (recovery CSRF, voir csrfRef
    // ci-dessus) : `send` lit `csrfRef.current` pour ne PAS changer d'identité
    // à chaque refresh de token — sinon `widgetActions` (memoïsé sur `send`)
    // en ferait autant, ce qui casserait le debounce d'autosave d'un widget
    // comme `MailDraftWidget` si celui-ci utilisait `actions` comme dépendance
    // d'effet.
    [busy],
  );

  const voice = useVoiceMode({
    csrfToken: csrf,
    onCsrfRefresh: setCsrf,
    busy,
    onTranscript: (text) => {
      nextTurnIsVoiceRef.current = true;
      void send(text);
    },
    onVoiceConfirm: (transcript) => {
      const pending = pendingConfirmRef.current;
      if (pending === null) return false;
      const intent = matchVoiceConfirm(transcript);
      if (intent === null) {
        // Ambigu (spec §4.4) : redemander à voix haute, widget toujours cliquable.
        speakRef.current('Dis clairement oui ou non, ou clique sur le bouton.');
        return true; // consommé — ne part pas en message
      }
      void answerConfirm(pending.id, intent === 'allow');
      return true;
    },
    // Interruption : tuer le chunker AVANT l'abort — sinon le `finally` de
    // send() flusherait le reliquat vers la file TTS fraîchement vidée (le
    // runId bumpé par queue.stop() ne protège pas d'un enqueue POSTÉRIEUR) et
    // la voix reprendrait par-dessus l'écoute. Ce tour ne vocalise plus rien.
    // `voiceTurnRef` reste vrai : une interruption OUVRE un nouvel échange
    // vocal (contrairement au bouton Stop, demande de silence explicite).
    onInterrupt: () => {
      chunkerRef.current = null;
      abortRef.current?.abort();
    },
  });
  speakRef.current = voice.speak;
  // Miroir du pendingConfirm pour le hook voix (état → ref, même valeur).
  pendingConfirmRef.current = pendingConfirm === null ? null : { id: pendingConfirm.id };

  // PTT ⌥ Option (décision produit) : maintien = écoute, relâche = envoi.
  //
  // Le champ de saisie est autofocusé après certains flux (ex. fermeture du
  // dialog de confirmation — voir l'effet de gestion du focus plus haut), et
  // rien n'empêche l'utilisateur de cliquer dedans à tout moment : Option y
  // sert normalement à composer des caractères accentués (Option+e = é,
  // Option+u = ü…), donc armer le PTT au premier keydown y ferait perdre
  // cette composition native ET partirait en écoute à chaque accent tapé.
  //
  // Quand le champ a le focus, on ne tranche donc pas au keydown : on arme un
  // délai `PTT_FOCUSED_HOLD_MS` et on observe ce qui arrive en premier — une
  // autre touche (composition, on annule), un keyup rapide (simple tap,
  // rien ne se passe), ou rien du tout avant l'échéance (maintien volontaire
  // → on retire le focus du champ puis on démarre l'écoute comme d'habitude).
  useEffect(() => {
    const PTT_FOCUSED_HOLD_MS = 250;
    const isTyping = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    };
    let focusedHoldTimer: ReturnType<typeof setTimeout> | null = null;
    const clearFocusedHoldTimer = () => {
      if (focusedHoldTimer !== null) {
        clearTimeout(focusedHoldTimer);
        focusedHoldTimer = null;
      }
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !e.repeat) {
        if (isTyping()) {
          // Pas de preventDefault ici : la composition native (Option+lettre)
          // doit rester intacte tant qu'on n'a pas tranché pour le PTT.
          clearFocusedHoldTimer();
          focusedHoldTimer = setTimeout(() => {
            focusedHoldTimer = null;
            inputRef.current?.blur();
            void voice.pressStart();
          }, PTT_FOCUSED_HOLD_MS);
          return;
        }
        e.preventDefault();
        void voice.pressStart();
        return;
      }
      // N'importe quelle AUTRE touche pendant le délai = composition d'accent
      // (Option+e…), pas un maintien PTT — on annule silencieusement. Les
      // keydown Alt repeat:true (Alt tenu émet des répétitions sous
      // Windows/Linux) ne comptent pas : c'est le même maintien, pas une
      // composition.
      if (focusedHoldTimer !== null && e.key !== 'Alt') clearFocusedHoldTimer();
      if (e.key === 'Escape' && voice.mode === 'recording') voice.cancel();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      clearFocusedHoldTimer(); // tap rapide en focus : rien ne s'était armé
      // INCONDITIONNEL (pas de garde `mode === 'recording'`) : le state peut
      // être en retard d'un render, et surtout la relâche peut arriver PENDANT
      // l'attente getUserMedia (dialogue de permission) — pressEnd no-ope sans
      // risque et recorder.stop() bump le jeton de génération, ce qui tue tout
      // start() encore suspendu (sinon : capture ambiante de 60 s auto-envoyée).
      void voice.pressEnd();
    };
    const blur = () => {
      // Maintien armé mais fenêtre quittée : ne jamais démarrer — sans ce
      // clear, le timer partirait sans personne devant (capture de 60 s
      // non surveillée, auto-envoyée à la borne).
      clearFocusedHoldTimer();
      // Alt+Tab / changement de fenêtre pendant l'écoute : le keyup n'arrivera
      // jamais — annuler (PAS pressEnd : l'utilisateur n'a pas voulu envoyer),
      // sinon capture d'ambiance de 60 s auto-transmise (vie privée).
      if (voice.mode === 'recording') voice.cancel();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      clearFocusedHoldTimer();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [voice]);

  /**
   * Canal d'actions transmis à `renderWidget` (Plan 5c) — identique pour les
   * messages déjà commités et pour le stream en cours : un widget d'un
   * message ANCIEN reste actif (« Répondre » sur un mail affiché il y a
   * plusieurs tours doit marcher), `busy` le neutralise pendant un tour.
   */
  const widgetActions: WidgetActions = useMemo(
    () => ({ sendMessage: (t: string) => void send(t), busy }),
    [send, busy],
  );

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center gap-4 px-6 py-8">
      <AssistantOrb
        activity={deriveOrbActivity({
          busy,
          streaming: streamText !== null && streamText !== '',
          listening: voice.mode === 'recording',
          // SSE fini mais la file TTS parle encore : l'orbe reste `responding`.
          speaking: voice.mode === 'speaking',
        })}
      />
      <h1 className="text-lg font-bold text-[color:var(--color-text-main)]">
        Bonjour {firstName} 👋
      </h1>
      {overview !== undefined ? (
        <>
          <DigestedBrief overview={overview} />
          <KpiCards data={overview} />
        </>
      ) : (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Demandez votre briefing, interrogez vos projets et vos mails.
        </p>
      )}

      {/* Pile de notices (Plan 3b Task 7) — entre les KPI et le fil, HORS
          aria-live (voir notice-stack.tsx : optimiste, pas d'annonce
          screen-reader dédiée). Rend `null` quand `notices` est vide/absent. */}
      <NoticeStack notices={notices ?? []} actions={widgetActions} />

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
                <Fragment key={widgetKey(w, wi)}>
                  {renderWidget(w.tool, w.data, widgetActions)}
                </Fragment>
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
            <Fragment key={widgetKey(w, wi)}>
              {renderWidget(w.tool, w.data, widgetActions)}
            </Fragment>
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

      <VoiceCapsule
        mode={voice.mode}
        onStop={() => {
          // Stop explicite = demande de silence pour TOUT le reste du tour :
          // tuer le chunker (sinon la prochaine phrase SSE ré-enqueue et la
          // voix reprend) ET désarmer voiceTurnRef (décision produit : un
          // confirm_request ultérieur du même tour ne doit pas être lu).
          chunkerRef.current = null;
          voiceTurnRef.current = false;
          voice.speakStop();
        }}
      />
      {voice.notice !== null && (
        <p className="text-xs text-[color:var(--color-text-ghost)]" role="status">
          {voice.notice}
        </p>
      )}

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
          placeholder="Demandez quelque chose… ou maintenez ⌥ Option pour parler"
          aria-label="Message"
          value={input}
          onChange={(e) => {
            inputValueRef.current = e.target.value;
            setInput(e.target.value);
          }}
          disabled={busy}
        />
        <button
          type="button"
          className="h-8 w-8 rounded-full bg-[color:var(--color-bg-hover)] text-sm disabled:opacity-45"
          title="Maintenir pour parler (ou maintenir ⌥ Option)"
          aria-label="Maintenir pour parler"
          disabled={voice.recorderUnsupported}
          onPointerDown={(e) => {
            e.preventDefault(); // pas de focus-steal du champ
            void voice.pressStart();
          }}
          onPointerUp={() => void voice.pressEnd()}
          onPointerLeave={() => {
            // Souris sortie du bouton pendant le maintien : équivalent relâche.
            if (voice.mode === 'recording') void voice.pressEnd();
          }}
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
