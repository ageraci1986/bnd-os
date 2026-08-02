// apps/web/features/assistant/hooks/use-voice-recorder.test.ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecorder } from './use-voice-recorder';

/** Faux MediaRecorder pilotable — jsdom n'en fournit pas. */
class FakeMediaRecorder {
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
const fakeStream = { getTracks: () => [fakeTrack] } as unknown as MediaStream;

/** Promesse getUserMedia résoluble à la main — simule le dialogue de permission. */
function deferredPermission() {
  let resolve!: (s: MediaStream) => void;
  const promise = new Promise<MediaStream>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Vide la file de microtâches (onstop différés) dans act(). */
const flushMicrotasks = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe('useVoiceRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('start() demande le micro et passe en recording', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('recording');
  });

  it('stop() résout avec le Blob et son mimeType', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });
    expect(blob).not.toBeNull();
    expect((blob as unknown as Blob).type).toBe('audio/webm;codecs=opus');
    expect(result.current.state).toBe('idle');
  });

  it('cancel() jette l’enregistrement sans résoudre de blob', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    act(() => result.current.cancel());
    await flushMicrotasks(); // l'event stop du recorder est différé
    expect(result.current.state).toBe('idle');
    // Après annulation, stop() n'a plus rien à livrer.
    let blob: Blob | null = new Blob(['sentinel']);
    await act(async () => {
      blob = await result.current.stop();
    });
    expect(blob).toBeNull();
  });

  it('borne à 60 s : auto-stop et blob disponible via onAutoStop', async () => {
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onAutoStop }));
    await act(() => result.current.start());
    // NOTE: testing-library's `waitFor` polls with real timers, which deadlocks
    // under `vi.useFakeTimers()` (its polling setInterval never fires). The fake
    // MediaRecorder delivers `onstop` via microtask, and `advanceTimersByTimeAsync`
    // flushes microtasks between ticks — no polling wait needed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect((onAutoStop.mock.calls[0]![0] as Blob).type).toContain('audio/webm');
  });

  it('permission refusée → state denied, pas de crash', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    );
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('denied');
  });

  it('navigateur sans MediaRecorder → state unsupported', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('unsupported');
  });

  describe('races pendant l’attente de permission (getUserMedia suspendu)', () => {
    it('keyup avant la permission : stop() pendant l’attente → aucun recorder orphelin', async () => {
      const perm = deferredPermission();
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockReturnValue(
        perm.promise,
      );
      const { result } = renderHook(() => useVoiceRecorder());
      const startP = result.current.start(); // suspend sur getUserMedia
      let blob: Blob | null = new Blob(['sentinel']);
      await act(async () => {
        blob = await result.current.stop(); // keyup pendant le dialogue
      });
      expect(blob).toBeNull();
      perm.resolve(fakeStream); // l'utilisateur accorde ENSUITE la permission
      await act(async () => {
        await startP;
      });
      // Sans le jeton de génération, start() reprendrait ici et enregistrerait
      // alors que personne ne tient la touche.
      expect(FakeMediaRecorder.instances).toHaveLength(0);
      expect(result.current.state).toBe('idle');
    });

    it('cancel() pendant l’attente de permission → capture abandonnée', async () => {
      const perm = deferredPermission();
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockReturnValue(
        perm.promise,
      );
      const { result } = renderHook(() => useVoiceRecorder());
      const startP = result.current.start();
      act(() => result.current.cancel());
      perm.resolve(fakeStream);
      await act(async () => {
        await startP;
      });
      expect(FakeMediaRecorder.instances).toHaveLength(0);
      expect(result.current.state).toBe('idle');
    });

    it('double start() pendant l’attente → un seul recorder créé', async () => {
      const perm = deferredPermission();
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockReturnValue(
        perm.promise,
      );
      const { result } = renderHook(() => useVoiceRecorder());
      const p1 = result.current.start();
      const p2 = result.current.start();
      perm.resolve(fakeStream);
      await act(async () => {
        await Promise.all([p1, p2]);
      });
      expect(FakeMediaRecorder.instances).toHaveLength(1);
      expect(result.current.state).toBe('recording');
    });

    it('cancel() puis start() immédiat : ni le onstop ni le dataavailable différés du vieux recorder ne polluent la nouvelle prise', async () => {
      const { result } = renderHook(() => useVoiceRecorder());
      await act(() => result.current.start());
      await act(async () => {
        result.current.cancel();
        await result.current.start(); // re-PTT avant que les events différés n'arrivent
      });
      await flushMicrotasks(); // le onstop + dataavailable du recorder annulé arrivent maintenant
      expect(FakeMediaRecorder.instances).toHaveLength(2);
      expect(result.current.state).toBe('recording'); // pas stompé en 'idle'
      // La 2e prise ne doit contenir QUE son propre chunk. Tailles uniques :
      // take 1 = 6 o, take 2 = 12 o → 12 = chunk de la prise 2 seule ;
      // 18 = fuite du chunk annulé en tête ; 6 = mauvaise prise conservée.
      let blob: Blob | null = null;
      await act(async () => {
        blob = await result.current.stop();
      });
      expect(blob).not.toBeNull();
      expect((blob as unknown as Blob).size).toBe(FakeMediaRecorder.instances[1]!.takeChunk.length);
    });
  });
});
