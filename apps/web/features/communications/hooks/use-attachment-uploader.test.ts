import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAttachmentUploader, MAX_ATTACHMENTS } from './use-attachment-uploader';

const uploadAttachment = vi.hoisted(() => vi.fn());
vi.mock('../actions/upload-attachment', () => ({
  uploadAttachment: (...a: unknown[]) => uploadAttachment(...a),
}));

function makeFile(name: string, sizeBytes: number, type = 'text/plain'): File {
  const file = new File(['x'], name, { type });
  // Override `size` rather than allocating a real `sizeBytes`-length buffer —
  // File.size is a regular own accessor in jsdom, safe to redefine for tests.
  Object.defineProperty(file, 'size', { value: sizeBytes, configurable: true });
  return file;
}

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    id: 'server-id',
    filename: 'a.txt',
    contentType: 'text/plain',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    storagePath: 'w/server-id',
    ...overrides,
  };
}

beforeEach(() => {
  uploadAttachment.mockReset();
});

describe('useAttachmentUploader', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useAttachmentUploader());
    expect(result.current.items).toEqual([]);
    expect(result.current.totalBytes).toBe(0);
  });

  it('happy path: one file goes uploading -> clean', async () => {
    uploadAttachment.mockResolvedValueOnce(successResult({ filename: 'report.pdf' }));
    const { result } = renderHook(() => useAttachmentUploader());

    let addPromise!: Promise<unknown>;
    act(() => {
      addPromise = result.current.addFiles([makeFile('report.pdf', 100, 'application/pdf')]);
    });

    // Immediately after the sync setItems call, the placeholder is 'uploading'.
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.state).toBe('uploading');

    await act(async () => {
      await addPromise;
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.state).toBe('clean');
    expect(result.current.items[0]?.filename).toBe('report.pdf');
    expect(result.current.items[0]?.id).toBe('server-id');
    expect(uploadAttachment).toHaveBeenCalledOnce();
  });

  it('parallel batch: independent per-file states via Promise.allSettled', async () => {
    uploadAttachment
      .mockResolvedValueOnce(successResult({ filename: 'ok.txt' }))
      .mockResolvedValueOnce({
        ok: false,
        code: 'DIRTY',
        message: "Fichier rejeté par l'antivirus.",
      })
      .mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useAttachmentUploader());

    await act(async () => {
      await result.current.addFiles([
        makeFile('ok.txt', 10),
        makeFile('bad.txt', 10),
        makeFile('crash.txt', 10),
      ]);
    });

    expect(result.current.items).toHaveLength(3);
    expect(uploadAttachment).toHaveBeenCalledTimes(3);
    const states = result.current.items.map((i) => i.state);
    expect(states).toContain('clean');
    expect(states).toContain('dirty');
    expect(states).toContain('error');
    const dirtyItem = result.current.items.find((i) => i.state === 'dirty');
    expect(dirtyItem?.error).toBe("Fichier rejeté par l'antivirus.");
    const errorItem = result.current.items.find((i) => i.filename === 'crash.txt');
    expect(errorItem?.state).toBe('error');
  });

  it('rejects oversized files client-side without calling the server action', async () => {
    const { result } = renderHook(() => useAttachmentUploader());

    let res: { accepted: number; capRejected: number; oversizeRejected: number };
    await act(async () => {
      res = await result.current.addFiles([makeFile('huge.zip', 26 * 1024 * 1024)]);
    });

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.state).toBe('error');
    expect(res!.accepted).toBe(0);
    expect(res!.oversizeRejected).toBe(1);
  });

  it('enforces the 20-file cap and reports capRejected', async () => {
    uploadAttachment.mockResolvedValue(successResult());
    const { result } = renderHook(() => useAttachmentUploader());

    // Fill up to the cap.
    await act(async () => {
      await result.current.addFiles(
        Array.from({ length: MAX_ATTACHMENTS }, (_, i) => makeFile(`f${i}.txt`, 10)),
      );
    });
    expect(result.current.items).toHaveLength(MAX_ATTACHMENTS);

    // One more file should be entirely rejected by the cap.
    let res: { accepted: number; capRejected: number; oversizeRejected: number };
    await act(async () => {
      res = await result.current.addFiles([makeFile('overflow.txt', 10)]);
    });

    expect(result.current.items).toHaveLength(MAX_ATTACHMENTS);
    expect(res!.capRejected).toBe(1);
    expect(res!.accepted).toBe(0);
  });

  it('removeItem drops the entry by id', async () => {
    uploadAttachment.mockResolvedValueOnce(successResult({ id: 'x1' }));
    const { result } = renderHook(() => useAttachmentUploader());
    await act(async () => {
      await result.current.addFiles([makeFile('a.txt', 10)]);
    });
    expect(result.current.items).toHaveLength(1);

    act(() => {
      result.current.removeItem('x1');
    });
    expect(result.current.items).toHaveLength(0);
  });

  it('setInitial preloads items (e.g. from a saved draft) and totalBytes sums them', () => {
    const { result } = renderHook(() => useAttachmentUploader());
    act(() => {
      result.current.setInitial([
        {
          id: '1',
          filename: 'a.txt',
          contentType: 'text/plain',
          sizeBytes: 100,
          storagePath: 'w/1',
          sha256: 'a'.repeat(64),
          state: 'clean',
        },
        {
          id: '2',
          filename: 'b.txt',
          contentType: 'text/plain',
          sizeBytes: 200,
          storagePath: 'w/2',
          sha256: 'b'.repeat(64),
          state: 'clean',
        },
      ]);
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.totalBytes).toBe(300);
  });

  it('clearAll empties the list', async () => {
    uploadAttachment.mockResolvedValueOnce(successResult());
    const { result } = renderHook(() => useAttachmentUploader());
    await act(async () => {
      await result.current.addFiles([makeFile('a.txt', 10)]);
    });
    expect(result.current.items.length).toBeGreaterThan(0);

    act(() => {
      result.current.clearAll();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(0));
  });
});
