import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  requestCardAttachmentUpload: vi.fn(),
  finalizeCardAttachment: vi.fn(),
  listCardAttachments: vi.fn(),
  getCardAttachmentUrl: vi.fn(),
  deleteCardAttachment: vi.fn(),
}));
const {
  uploadToSignedUrl,
  notify,
  getAttachmentInlineUrl,
  getAttachmentThumbUrl,
  downloadCardAttachment,
} = vi.hoisted(() => ({
  uploadToSignedUrl: vi.fn(),
  notify: vi.fn(),
  getAttachmentInlineUrl: vi.fn(),
  getAttachmentThumbUrl: vi.fn(),
  downloadCardAttachment: vi.fn(),
}));

vi.mock('../actions/card-attachments', () => actions);
vi.mock('../lib/upload-to-signed-url', () => ({ uploadToSignedUrl }));
vi.mock('../lib/attachment-url-cache', () => ({
  getAttachmentInlineUrl,
  getAttachmentThumbUrl,
  forgetAttachmentUrl: vi.fn(),
}));
vi.mock('../lib/attachment-download', () => ({ downloadCardAttachment }));
vi.mock('@/features/shell/components/toaster', () => ({ notify }));
vi.mock('./card-modal-controller', () => ({ CARD_UPDATED_EVENT: 'nx:card-updated' }));

import { CardAttachmentsSection } from './card-attachments-section';
import type { CardAttachmentDTO } from '../lib/card-attachment-core';

const CARD_ID = '11111111-1111-1111-1111-111111111111';

function att(over: Partial<CardAttachmentDTO> & { id: string }): CardAttachmentDTO {
  return {
    filename: 'brief.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
    scanStatus: 'clean',
    uploaderName: 'Alice Martin',
    createdAt: '2026-10-01T10:00:00.000Z',
    canDelete: false,
    ...over,
  };
}

function pick(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

/** Flush pending microtasks (server action promises) inside act. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe('<CardAttachmentsSection />', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const fn of Object.values(actions)) fn.mockReset();
    uploadToSignedUrl.mockReset();
    notify.mockReset();
    downloadCardAttachment.mockReset();
    getAttachmentInlineUrl.mockReset();
    getAttachmentInlineUrl.mockResolvedValue('https://cdn.test/thumb');
    getAttachmentThumbUrl.mockReset();
    getAttachmentThumbUrl.mockResolvedValue('https://cdn.test/thumb');
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('renders the initial attachments with name, size and author', () => {
    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'a1' }), att({ id: 'a2', filename: 'notes.txt' })]}
        canUpload
      />,
    );
    expect(screen.getByRole('heading', { name: /Pièces jointes/ })).toHaveTextContent('2');
    expect(screen.getByText('brief.pdf')).toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getAllByText(/2 Ko/)).toHaveLength(2);
    expect(screen.getAllByText(/Alice Martin/)).toHaveLength(2);
  });

  it('shows Supprimer only when canDelete', () => {
    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'a1', canDelete: true }), att({ id: 'a2', filename: 'other.pdf' })]}
        canUpload
      />,
    );
    expect(screen.getAllByRole('button', { name: /^Supprimer/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Supprimer brief.pdf' })).toBeInTheDocument();
  });

  it('hides the add zone when !canUpload', () => {
    render(<CardAttachmentsSection cardId={CARD_ID} initial={[]} canUpload={false} />);
    expect(screen.queryByRole('button', { name: /Ajouter des fichiers/ })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('rejects a disallowed file locally (toast, no server call)', async () => {
    render(<CardAttachmentsSection cardId={CARD_ID} initial={[]} canUpload />);
    pick([new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' })]);
    await flush();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(actions.requestCardAttachmentUpload).not.toHaveBeenCalled();
  });

  it('rejects a file over 50 Mo locally', async () => {
    render(<CardAttachmentsSection cardId={CARD_ID} initial={[]} canUpload />);
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 });
    pick([big]);
    await flush();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'error', message: expect.stringMatching(/50 Mo/) }),
    );
    expect(actions.requestCardAttachmentUpload).not.toHaveBeenCalled();
  });

  it('runs request → upload (progress) → finalize → "Analyse en cours…"', async () => {
    actions.requestCardAttachmentUpload.mockResolvedValue({
      ok: true,
      attachmentId: 'new-1',
      signedUrl: 'https://x.supabase.co/storage/v1/object/upload/sign/p?token=t',
      token: 't',
      path: 'p',
    });
    let finishUpload: () => void = vi.fn();
    uploadToSignedUrl.mockImplementation(
      (input: { onProgress?: (f: number) => void }) =>
        new Promise<void>((resolve) => {
          input.onProgress?.(0.4);
          finishUpload = resolve;
        }),
    );
    actions.finalizeCardAttachment.mockResolvedValue({ ok: true });
    actions.listCardAttachments.mockResolvedValue({
      ok: true,
      attachments: [],
      recentlyRejected: [],
    });

    render(<CardAttachmentsSection cardId={CARD_ID} initial={[]} canUpload />);
    pick([new File(['png'], 'maquette.png', { type: 'image/png' })]);
    await flush();

    expect(actions.requestCardAttachmentUpload).toHaveBeenCalledWith({
      cardId: CARD_ID,
      filename: 'maquette.png',
      contentType: 'image/png',
      sizeBytes: 3,
    });
    const bar = screen.getByRole('progressbar', { name: /maquette\.png/ });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl: 'https://x.supabase.co/storage/v1/object/upload/sign/p?token=t',
        contentType: 'image/png',
      }),
    );

    await act(async () => finishUpload());
    await flush();
    expect(actions.finalizeCardAttachment).toHaveBeenCalledWith({ attachmentId: 'new-1' });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Analyse en cours…')).toBeInTheDocument();
    expect(screen.getByText('maquette.png')).toBeInTheDocument();
  });

  it('removes the row and toasts when the request is refused', async () => {
    actions.requestCardAttachmentUpload.mockResolvedValue({
      ok: false,
      code: 'TOO_MANY',
      message: 'Nombre maximal de pièces jointes atteint (50).',
    });
    render(<CardAttachmentsSection cardId={CARD_ID} initial={[]} canUpload />);
    pick([new File(['x'], 'a.pdf', { type: 'application/pdf' })]);
    await flush();
    expect(notify).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Nombre maximal de pièces jointes atteint (50).',
    });
    expect(screen.queryByText('a.pdf')).toBeNull();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('cleans up the pending row when the upload itself fails', async () => {
    actions.requestCardAttachmentUpload.mockResolvedValue({
      ok: true,
      attachmentId: 'new-2',
      signedUrl: 'https://x/s',
      token: 't',
      path: 'p',
    });
    uploadToSignedUrl.mockRejectedValue(new Error('Upload failed (HTTP 400)'));
    actions.deleteCardAttachment.mockResolvedValue({ ok: true });
    render(<CardAttachmentsSection cardId={CARD_ID} initial={[]} canUpload />);
    pick([new File(['x'], 'a.pdf', { type: 'application/pdf' })]);
    await flush();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(actions.deleteCardAttachment).toHaveBeenCalledWith({ attachmentId: 'new-2' });
    expect(actions.finalizeCardAttachment).not.toHaveBeenCalled();
    expect(screen.queryByText('a.pdf')).toBeNull();
  });

  it('polls every 3 s while pending, flips to clean and notifies the board', async () => {
    const events: unknown[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener('nx:card-updated', listener);
    actions.listCardAttachments.mockResolvedValue({
      ok: true,
      attachments: [att({ id: 'p1', filename: 'scan.pdf' })],
      recentlyRejected: [],
    });

    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'p1', filename: 'scan.pdf', scanStatus: 'pending' })]}
        canUpload
      />,
    );
    expect(screen.getByText('Analyse en cours…')).toBeInTheDocument();
    expect(actions.listCardAttachments).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flush();
    expect(actions.listCardAttachments).toHaveBeenCalledWith({ cardId: CARD_ID });
    expect(screen.queryByText('Analyse en cours…')).toBeNull();
    expect(events).toEqual([{ id: CARD_ID, attachmentCount: 1 }]);

    // No pending left → polling stopped.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(actions.listCardAttachments).toHaveBeenCalledTimes(1);
    window.removeEventListener('nx:card-updated', listener);
  });

  it.each([
    ['virus', 'Fichier refusé par l’antivirus.'],
    ['type', 'Type de fichier non conforme.'],
    ['size', 'Taille de fichier incohérente.'],
    ['scan_failed', 'Analyse impossible, réessaie plus tard.'],
  ] as const)(
    'toasts the explicit reason when my pending attachment is rejected (%s)',
    async (rejectReason, message) => {
      actions.listCardAttachments.mockResolvedValue({
        ok: true,
        attachments: [],
        recentlyRejected: [{ id: 'p1', rejectReason }],
      });
      render(
        <CardAttachmentsSection
          cardId={CARD_ID}
          initial={[att({ id: 'p1', filename: 'bad.zip', scanStatus: 'pending' })]}
          canUpload
        />,
      );
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      await flush();
      expect(notify).toHaveBeenCalledWith({ tone: 'error', message: `« bad.zip » : ${message}` });
      expect(screen.queryByText('bad.zip')).toBeNull();
    },
  );

  it('does not toast when someone else’s pending attachment disappears (no known reason)', async () => {
    actions.listCardAttachments.mockResolvedValue({
      ok: true,
      attachments: [],
      recentlyRejected: [],
    });
    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'p1', filename: 'theirs.zip', scanStatus: 'pending' })]}
        canUpload
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flush();
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByText('theirs.zip')).toBeNull();
  });

  it('stops polling after 2 minutes', async () => {
    actions.listCardAttachments.mockResolvedValue({
      ok: true,
      attachments: [att({ id: 'p1', scanStatus: 'pending' })],
      recentlyRejected: [],
    });
    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'p1', scanStatus: 'pending' })]}
        canUpload
      />,
    );
    for (let i = 0; i < 50; i++) {
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
    }
    const calls = actions.listCardAttachments.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(40);
    expect(calls).toBeGreaterThanOrEqual(39);
  });

  it('offers an "Actualiser" button once polling gave up, which restarts polling', async () => {
    actions.listCardAttachments.mockResolvedValue({
      ok: true,
      attachments: [att({ id: 'p1', scanStatus: 'pending' })],
      recentlyRejected: [],
    });
    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'p1', scanStatus: 'pending' })]}
        canUpload
      />,
    );
    expect(screen.queryByRole('button', { name: 'Actualiser' })).toBeNull();
    for (let i = 0; i < 45; i++) {
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
    }
    const before = actions.listCardAttachments.mock.calls.length;
    const refresh = screen.getByRole('button', { name: 'Actualiser' });
    fireEvent.click(refresh);
    expect(screen.queryByRole('button', { name: 'Actualiser' })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flush();
    expect(actions.listCardAttachments.mock.calls.length).toBe(before + 1);
  });

  it('stops polling on unmount', async () => {
    actions.listCardAttachments.mockResolvedValue({
      ok: true,
      attachments: [att({ id: 'p1', scanStatus: 'pending' })],
      recentlyRejected: [],
    });
    const { unmount } = render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'p1', scanStatus: 'pending' })]}
        canUpload
      />,
    );
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(actions.listCardAttachments).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('deletes after confirmation and updates the count', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    actions.deleteCardAttachment.mockResolvedValue({ ok: true });
    const events: unknown[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener('nx:card-updated', listener);
    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'a1', canDelete: true })]}
        canUpload
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer brief.pdf' }));
    await flush();
    expect(actions.deleteCardAttachment).toHaveBeenCalledWith({ attachmentId: 'a1' });
    expect(screen.queryByText('brief.pdf')).toBeNull();
    expect(events).toEqual([{ id: CARD_ID, attachmentCount: 0 }]);
    window.removeEventListener('nx:card-updated', listener);
  });

  it('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'a1', canDelete: true })]}
        canUpload
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer brief.pdf' }));
    await flush();
    expect(actions.deleteCardAttachment).not.toHaveBeenCalled();
  });

  it('downloads a clean attachment', async () => {
    render(<CardAttachmentsSection cardId={CARD_ID} initial={[att({ id: 'a1' })]} canUpload />);
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger brief.pdf' }));
    expect(downloadCardAttachment).toHaveBeenCalledWith('a1');
  });

  it('loads image thumbnails lazily for clean images only', async () => {
    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[
          att({ id: 'i1', filename: 'a.png', contentType: 'image/png' }),
          att({ id: 'i2', filename: 'b.png', contentType: 'image/png', scanStatus: 'pending' }),
        ]}
        canUpload
      />,
    );
    await flush();
    // Lot de vignettes par carte (un seul appel serveur partagé), pas d'URL unitaire.
    expect(getAttachmentThumbUrl).toHaveBeenCalledTimes(1);
    expect(getAttachmentThumbUrl).toHaveBeenCalledWith(CARD_ID, 'i1');
    expect(getAttachmentInlineUrl).not.toHaveBeenCalled();
    // Decorative thumbnail (alt="") inside the "Ouvrir a.png" button.
    const open = screen.getByRole('button', { name: 'Ouvrir a.png' });
    const img = within(open).getByRole('presentation');
    expect(img).toHaveAttribute('src', 'https://cdn.test/thumb');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('opens the viewer when a clean attachment is activated', async () => {
    render(
      <CardAttachmentsSection
        cardId={CARD_ID}
        initial={[att({ id: 'i1', filename: 'a.png', contentType: 'image/png' })]}
        canUpload
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir a.png' }));
    expect(screen.getByRole('dialog', { name: 'a.png' })).toBeInTheDocument();
    await flush();
  });
});
