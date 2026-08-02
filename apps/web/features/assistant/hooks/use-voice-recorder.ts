'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Capture micro PTT (spec §1/§2) : getUserMedia + MediaRecorder, borne 60 s.
 * Aucun réseau ici — rend un Blob, l'appelant transcrit. Le stream micro est
 * conservé après la première autorisation (latence d'attaque ~0 aux PTT
 * suivants) et coupé au démontage.
 */

export type RecorderState = 'idle' | 'recording' | 'denied' | 'unsupported';

const MAX_RECORDING_MS = 60_000;

/** Safari ne supporte pas webm/opus — repli mp4 (AAC), accepté par Deepgram. */
function pickMimeType(): string {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return '';
}

export interface UseVoiceRecorderOptions {
  /** Appelé avec le Blob quand la borne des 60 s force l'arrêt. */
  readonly onAutoStop?: (blob: Blob) => void;
}

export function useVoiceRecorder(options?: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  /**
   * Jeton de génération : `stop()`/`cancel()`/un nouveau `start()` l'incrémentent.
   * Un `start()` suspendu sur `getUserMedia` (le dialogue de permission peut
   * bloquer des secondes) revérifie qu'il est toujours le plus récent avant de
   * créer un recorder — sinon on enregistrerait alors que la touche est déjà
   * relâchée (enregistrement orphelin, fuite micro).
   */
  const generationRef = useRef(0);
  const onAutoStopRef = useRef<((blob: Blob) => void) | undefined>(options?.onAutoStop);
  onAutoStopRef.current = options?.onAutoStop;

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
    },
    [],
  );

  const buildBlob = useCallback((): Blob => {
    const type = recorderRef.current?.mimeType ?? 'audio/webm';
    return new Blob(chunksRef.current, { type });
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (recorderRef.current?.state === 'recording') return;
    if (typeof MediaRecorder === 'undefined') {
      setState('unsupported');
      return;
    }
    const generation = ++generationRef.current;
    try {
      streamRef.current ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (generation === generationRef.current) setState('denied');
      return;
    }
    // stop()/cancel()/un start() plus récent est passé pendant l'attente de la
    // permission → cette capture est obsolète, ne pas démarrer de recorder.
    if (generation !== generationRef.current) return;
    cancelledRef.current = false;
    chunksRef.current = [];
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(
      streamRef.current,
      mimeType !== '' ? { mimeType } : undefined,
    );
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 || chunksRef.current.length === 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    setState('recording');
    timerRef.current = setTimeout(() => {
      // Borne 60 s (spec §2) : arrêt forcé, blob livré via onAutoStop.
      if (recorderRef.current !== recorder || recorder.state !== 'recording') return;
      recorder.onstop = () => {
        // L'event stop arrive en tâche différée : un nouveau recorder a pu
        // remplacer celui-ci entre-temps — ne pas écraser son état.
        if (recorderRef.current !== recorder) return;
        setState('idle');
        onAutoStopRef.current?.(buildBlob());
      };
      recorder.stop();
    }, MAX_RECORDING_MS);
  }, [buildBlob]);

  /** Arrête et résout avec l'audio capturé (null si annulé/vide). */
  const stop = useCallback((): Promise<Blob | null> => {
    generationRef.current++; // invalide tout start() encore suspendu sur getUserMedia
    const recorder = recorderRef.current;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (recorder === null || recorder.state !== 'recording') return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        if (recorderRef.current !== recorder) {
          resolve(null); // recorder remplacé entre-temps — ne pas stomper l'état
          return;
        }
        setState('idle');
        resolve(cancelledRef.current ? null : buildBlob());
      };
      recorder.stop();
    });
  }, [buildBlob]);

  const cancel = useCallback((): void => {
    generationRef.current++; // invalide tout start() encore suspendu sur getUserMedia
    cancelledRef.current = true;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state === 'recording') {
      recorder.onstop = () => {
        if (recorderRef.current !== recorder) return;
        setState('idle');
      };
      recorder.stop();
    } else {
      setState('idle');
    }
  }, []);

  return { state, start, stop, cancel } as const;
}
