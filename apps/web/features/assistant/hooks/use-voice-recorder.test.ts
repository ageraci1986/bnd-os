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
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['aud'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const fakeTrack = { stop: vi.fn() };
const fakeStream = { getTracks: () => [fakeTrack] } as unknown as MediaStream;

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
    expect(result.current.state).toBe('idle');
  });

  it('borne à 60 s : auto-stop et blob disponible via onAutoStop', async () => {
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onAutoStop }));
    await act(() => result.current.start());
    // NOTE: testing-library's `waitFor` polls with real timers, which deadlocks
    // under `vi.useFakeTimers()` (its polling setInterval never fires). Since the
    // fake MediaRecorder resolves `onstop` synchronously, `advanceTimersByTimeAsync`
    // (which flushes microtasks) is enough — no polling wait needed.
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
});
