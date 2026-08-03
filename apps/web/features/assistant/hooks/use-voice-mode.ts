'use client';

import { useCallback, useRef, useState } from 'react';
import { useSpeechQueue } from './use-speech-queue';
import { useVoiceRecorder } from './use-voice-recorder';

/**
 * Orchestrateur du mode voix (spec §1) : relie PTT → capture → transcription
 * → chat. Fournit aussi la file TTS (speak/speakStop) au composant chat qui
 * y pousse les phrases du chunker. La détection Option/Échap reste dans le
 * composant (elle a besoin du DOM du chat) ; ici, la logique d'états.
 */

export type VoiceUiMode = 'idle' | 'recording' | 'transcribing' | 'speaking' | 'denied';

export interface UseVoiceModeProps {
  readonly csrfToken: string;
  /** Tour en cours (stream/outil) — un pressStart pendant busy = interruption. */
  readonly busy: boolean;
  /** Transcript prêt à envoyer comme message utilisateur (tour VOCAL). */
  readonly onTranscript: (text: string) => void;
  /**
   * Confirmation gated en attente : renvoie true si le transcript a été
   * consommé comme réponse Autoriser/Refuser (il ne part alors PAS en message).
   */
  readonly onVoiceConfirm: (transcript: string) => boolean;
  /** Interrompre le tour en cours (abort du stream) avant de réécouter. */
  readonly onInterrupt: () => void;
}

export function useVoiceMode(props: UseVoiceModeProps) {
  const [transcribing, setTranscribing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useSpeechQueue(props.csrfToken);
  const propsRef = useRef(props);
  // « Latest ref » volontaire (même pattern que csrfRef du speech-queue).
  propsRef.current = props;

  const handleBlob = useCallback(async (blob: Blob): Promise<void> => {
    setTranscribing(true);
    setNotice(null);
    try {
      const res = await fetch('/api/assistant/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': blob.type, 'x-csrf-token': propsRef.current.csrfToken },
        body: blob,
      });
      const payload = (await res.json().catch(() => null)) as {
        transcript?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        setNotice(payload?.message ?? 'Transcription indisponible — réessayez.');
        return;
      }
      const transcript = payload?.transcript?.trim() ?? '';
      if (transcript === '') {
        setNotice("Je n'ai rien entendu — réessaie en parlant après avoir appuyé.");
        return;
      }
      // Confirmation gated en attente : le transcript est d'abord proposé
      // comme réponse Autoriser/Refuser (matching strict côté chat).
      if (propsRef.current.onVoiceConfirm(transcript)) return;
      propsRef.current.onTranscript(transcript);
    } catch {
      setNotice('Transcription indisponible — réessayez.');
    } finally {
      setTranscribing(false);
    }
  }, []);

  const recorder = useVoiceRecorder({ onAutoStop: (blob) => void handleBlob(blob) });

  const pressStart = useCallback(async (): Promise<void> => {
    setNotice(null);
    // Interruption (spec §1) : couper lecture + génération, puis écouter.
    if (queue.speaking || propsRef.current.busy) {
      queue.stop();
      propsRef.current.onInterrupt();
    }
    await recorder.start();
  }, [queue, recorder]);

  const pressEnd = useCallback(async (): Promise<void> => {
    const blob = await recorder.stop();
    if (blob !== null && blob.size > 0) await handleBlob(blob);
  }, [recorder, handleBlob]);

  const cancel = useCallback((): void => {
    recorder.cancel();
  }, [recorder]);

  const mode: VoiceUiMode =
    recorder.state === 'denied'
      ? 'denied'
      : recorder.state === 'recording'
        ? 'recording'
        : transcribing
          ? 'transcribing'
          : queue.speaking
            ? 'speaking'
            : 'idle';

  return {
    mode,
    notice,
    pressStart,
    pressEnd,
    cancel,
    /** Pousse une phrase du chunker dans la file TTS. */
    speak: queue.enqueue,
    /** Coupe la lecture en cours (bouton Stop). */
    speakStop: queue.stop,
    recorderUnsupported: recorder.state === 'unsupported',
  } as const;
}
