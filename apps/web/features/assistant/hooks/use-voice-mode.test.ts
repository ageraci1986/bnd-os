// apps/web/features/assistant/hooks/use-voice-mode.test.ts
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recorder: {
    state: 'idle' as string,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'audio/webm' })),
    cancel: vi.fn(),
  },
  queue: { enqueue: vi.fn(), stop: vi.fn(), speaking: false },
}));
vi.mock('./use-voice-recorder', () => ({ useVoiceRecorder: () => mocks.recorder }));
vi.mock('./use-speech-queue', () => ({ useSpeechQueue: () => mocks.queue }));

import { useVoiceMode } from './use-voice-mode';

function setup(over?: Partial<Parameters<typeof useVoiceMode>[0]>) {
  const props = {
    csrfToken: 't',
    busy: false,
    onTranscript: vi.fn(),
    onVoiceConfirm: vi.fn().mockReturnValue(false),
    onInterrupt: vi.fn(),
    ...over,
  };
  return { ...renderHook(() => useVoiceMode(props)), props };
}

describe('useVoiceMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recorder.state = 'idle';
    mocks.queue.speaking = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, transcript: 'déplace la carte' }), {
          status: 200,
        }),
      ),
    );
  });

  it('pressStart → recorder.start ; pressEnd → transcribe → onTranscript(texte)', async () => {
    const { result, props } = setup();
    await act(() => result.current.pressStart());
    expect(mocks.recorder.start).toHaveBeenCalled();
    mocks.recorder.state = 'recording';
    await act(() => result.current.pressEnd());
    await waitFor(() => expect(props.onTranscript).toHaveBeenCalledWith('déplace la carte'));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe('/api/assistant/voice/transcribe');
    expect((init as RequestInit).headers).toMatchObject({ 'x-csrf-token': 't' });
  });

  it('transcript vide → notice "rien entendu", pas de onTranscript', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, transcript: '' }), { status: 200 }),
    );
    const { result, props } = setup();
    await act(() => result.current.pressStart());
    mocks.recorder.state = 'recording';
    await act(() => result.current.pressEnd());
    await waitFor(() => expect(result.current.notice).toMatch(/rien entendu/i));
    expect(props.onTranscript).not.toHaveBeenCalled();
  });

  it('confirm en attente : onVoiceConfirm=true consomme le transcript', async () => {
    const { result, props } = setup({ onVoiceConfirm: vi.fn().mockReturnValue(true) });
    await act(() => result.current.pressStart());
    mocks.recorder.state = 'recording';
    await act(() => result.current.pressEnd());
    await waitFor(() => expect(props.onVoiceConfirm).toHaveBeenCalledWith('déplace la carte'));
    expect(props.onTranscript).not.toHaveBeenCalled();
  });

  it('pressStart pendant busy → onInterrupt + queue.stop puis écoute', async () => {
    const { result, props } = setup({ busy: true });
    await act(() => result.current.pressStart());
    expect(props.onInterrupt).toHaveBeenCalled();
    expect(mocks.queue.stop).toHaveBeenCalled();
    expect(mocks.recorder.start).toHaveBeenCalled();
  });

  it('cancel (Échap) annule sans transcription', async () => {
    const { result, props } = setup();
    await act(() => result.current.pressStart());
    mocks.recorder.state = 'recording';
    act(() => result.current.cancel());
    expect(mocks.recorder.cancel).toHaveBeenCalled();
    expect(props.onTranscript).not.toHaveBeenCalled();
  });

  it('erreur route transcribe → notice avec le message serveur', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, message: 'Transcription indisponible — réessayez.' }),
        { status: 502 },
      ),
    );
    const { result } = setup();
    await act(() => result.current.pressStart());
    mocks.recorder.state = 'recording';
    await act(() => result.current.pressEnd());
    await waitFor(() => expect(result.current.notice).toMatch(/indisponible/));
  });
});
