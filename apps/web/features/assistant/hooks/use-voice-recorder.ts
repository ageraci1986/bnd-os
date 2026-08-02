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
  const onAutoStopRef = useRef<((blob: Blob) => void) | undefined>(options?.onAutoStop);
  onAutoStopRef.current = options?.onAutoStop;

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
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
    try {
      streamRef.current ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('denied');
      return;
    }
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
      if (recorderRef.current?.state !== 'recording') return;
      recorderRef.current.onstop = () => {
        setState('idle');
        onAutoStopRef.current?.(buildBlob());
      };
      recorderRef.current.stop();
    }, MAX_RECORDING_MS);
  }, [buildBlob]);

  /** Arrête et résout avec l'audio capturé (null si annulé/vide). */
  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (recorder === null || recorder.state !== 'recording') return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        setState('idle');
        resolve(cancelledRef.current ? null : buildBlob());
      };
      recorder.stop();
    });
  }, [buildBlob]);

  const cancel = useCallback((): void => {
    cancelledRef.current = true;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state === 'recording') {
      recorder.onstop = () => setState('idle');
      recorder.stop();
    } else {
      setState('idle');
    }
  }, []);

  return { state, start, stop, cancel } as const;
}
