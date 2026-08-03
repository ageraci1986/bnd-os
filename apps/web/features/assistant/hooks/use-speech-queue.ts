'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * File TTS séquentielle (spec §3) : enqueue(phrase) → fetch /speak →
 * decodeAudioData → lecture. Une seule phrase à la fois ; stop() vide tout
 * (Stop / interruption / nouveau tour). Une phrase en échec est SAUTÉE
 * (mieux vaut perdre une phrase que bloquer la réponse vocale entière).
 * L'AudioContext est créé au premier enqueue — toujours suite à un geste
 * utilisateur (relâche PTT), donc jamais bloqué par l'autoplay policy.
 *
 * Réutilisabilité après stop() : chaque appel à drain() reçoit un
 * `runId` figé à sa création. stop() incrémente `runIdRef`, ce qui rend le
 * `runId` capturé par toute boucle en vol obsolète — elle sort au prochain
 * point de contrôle sans jamais toucher `playingRef`/`speaking` (déjà remis
 * à false par stop()). Un enqueue() qui suit stop() relance drain() avec le
 * runId courant et repart proprement, y compris si l'ancienne boucle est
 * encore en train de dérouler son fetch/décodage en arrière-plan.
 */

export function useSpeechQueue(csrfToken: string) {
  const [speaking, setSpeaking] = useState(false);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const csrfRef = useRef(csrfToken);
  // « Latest ref » volontaire : réécrit à chaque render pour que drain() lise
  // toujours le token courant sans invalider ses callbacks mémoïsés.
  csrfRef.current = csrfToken;

  const stop = useCallback((): void => {
    queueRef.current = [];
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    try {
      sourceRef.current?.stop();
    } catch {
      // déjà arrêtée — sans conséquence
    }
    sourceRef.current = null;
    playingRef.current = false;
    setSpeaking(false);
  }, []);

  // Démontage : stop() PUIS close() du AudioContext — un contexte non fermé
  // n'est pas GC-éligible et les navigateurs plafonnent le nombre de contextes
  // simultanés ; sans close(), ils s'accumulent au fil des navigations client.
  // stop() lui-même ne ferme jamais le contexte : il est aussi appelé pour les
  // interruptions/Stop, où le contexte doit rester utilisable pour la suite.
  useEffect(
    () => () => {
      stop();
      void ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    },
    [stop],
  );

  const drain = useCallback(async (runId: number): Promise<void> => {
    if (playingRef.current) return;
    playingRef.current = true;
    setSpeaking(true);
    while (queueRef.current.length > 0) {
      if (runIdRef.current !== runId) return; // stop() a invalidé cette boucle
      const text = queueRef.current.shift();
      if (text === undefined) break;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch('/api/assistant/voice/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfRef.current },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (runIdRef.current !== runId) return;
        if (!res.ok) continue; // phrase sautée
        const bytes = await res.arrayBuffer();
        const ctx = ctxRef.current ?? new AudioContext();
        ctxRef.current = ctx;
        if (ctx.state === 'suspended') await ctx.resume();
        const audio = await ctx.decodeAudioData(bytes);
        // stop() pendant le fetch/décodage : cette boucle est obsolète, sortir.
        if (runIdRef.current !== runId) return;
        await new Promise<void>((resolve) => {
          const source = ctx.createBufferSource();
          source.buffer = audio;
          source.connect(ctx.destination);
          source.onended = () => resolve();
          sourceRef.current = source;
          source.start();
        });
        // Guard runId : si stop() + un nouveau tour sont passés pendant que
        // l'onended de CE run était en vol, sourceRef pointe déjà sur la
        // source du run suivant — ne pas l'écraser (sinon un stop() ultérieur
        // ne pourrait plus couper cette nouvelle source).
        if (runIdRef.current === runId) sourceRef.current = null;
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
        // réseau/décodage : phrase sautée, on continue
      }
    }
    // Boucle épuisée naturellement (pas via stop()) : remettre l'état à repos.
    if (runIdRef.current === runId) {
      playingRef.current = false;
      setSpeaking(false);
    }
  }, []);

  const enqueue = useCallback(
    (sentence: string): void => {
      if (sentence.trim() === '') return;
      queueRef.current.push(sentence);
      void drain(runIdRef.current);
    },
    [drain],
  );

  return { enqueue, stop, speaking } as const;
}
