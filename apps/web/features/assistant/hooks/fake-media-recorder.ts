// apps/web/features/assistant/hooks/fake-media-recorder.ts
import { vi } from 'vitest';

/**
 * Faux MediaRecorder pilotable — jsdom n'en fournit pas. Extrait de
 * use-voice-recorder.test.ts pour être réutilisé par assistant-chat.test.tsx
 * (intégration mode voix, Plan Voix Task 9).
 */
export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = 'inactive';
  readonly mimeType: string;
  /**
   * Chunk distinctif par instance, de TAILLE unique ("take-1" = 6 o, "take-2take-2"
   * = 12 o…) : le Blob de jsdom n'a pas .text(), on trace les fuites via .size.
   */
  readonly takeChunk: string;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    const take = FakeMediaRecorder.instances.push(this);
    this.takeChunk = `take-${take}`.repeat(take);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    // Fidèle aux vrais navigateurs : dataavailable/stop arrivent en tâche
    // DIFFÉRÉE, jamais synchrone — c'est ce qui rend les races détectables.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([this.takeChunk], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

const fakeTrack = { stop: vi.fn() };
export const fakeStream = { getTracks: () => [fakeTrack] } as unknown as MediaStream;

/**
 * Installe `MediaRecorder` + `navigator.mediaDevices.getUserMedia` mockés
 * (permission accordée immédiatement). Réinitialise `FakeMediaRecorder.instances`.
 */
export function installFakeMediaRecorder(): void {
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
  });
}

interface FakeSource {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

/**
 * Faux AudioContext : lecture instantanée (onended via microtask au start).
 * Extrait de use-speech-queue.test.ts pour la même raison que ci-dessus.
 */
export class FakeAudioContext {
  static created = 0;
  static sources: FakeSource[] = [];
  static autoEnd = true;
  state = 'running';
  constructor() {
    FakeAudioContext.created += 1;
  }
  decodeAudioData(buf: ArrayBuffer): Promise<AudioBuffer> {
    if (buf.byteLength === 0) return Promise.reject(new Error('decode'));
    return Promise.resolve({ duration: 0.1 } as AudioBuffer);
  }
  createBufferSource() {
    const source: FakeSource = {
      buffer: null,
      onended: null,
      connect: vi.fn(),
      start: vi.fn(() => {
        if (FakeAudioContext.autoEnd) queueMicrotask(() => source.onended?.());
      }),
      stop: vi.fn(),
    };
    FakeAudioContext.sources.push(source);
    return source;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  get destination() {
    return {};
  }
}

/** Installe `AudioContext` mocké. Réinitialise le compteur et les sources. */
export function installFakeAudioContext(): void {
  FakeAudioContext.created = 0;
  FakeAudioContext.sources = [];
  FakeAudioContext.autoEnd = true;
  vi.stubGlobal('AudioContext', FakeAudioContext);
}
