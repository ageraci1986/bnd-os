import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

const { getAttachmentInlineUrl } = vi.hoisted(() => ({ getAttachmentInlineUrl: vi.fn() }));
vi.mock('../lib/attachment-url-cache', () => ({ getAttachmentInlineUrl }));

import { AttachmentViewer } from './attachment-viewer';
import type { CardAttachmentDTO } from '../lib/card-attachment-core';

function att(id: string, filename: string, contentType: string): CardAttachmentDTO {
  return {
    id,
    filename,
    contentType,
    sizeBytes: 1000,
    scanStatus: 'clean',
    uploaderName: 'Alice',
    createdAt: '2026-10-01T10:00:00.000Z',
    canDelete: true,
  };
}

const items = [
  att('a1', 'photo.png', 'image/png'),
  att('a2', 'clip.mp4', 'video/mp4'),
  att('a3', 'doc.pdf', 'application/pdf'),
  att('a4', 'sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
];

function Harness(props: { start: number; onClose?: () => void; onDownload?: () => void }) {
  const [index, setIndex] = useState(props.start);
  return (
    <AttachmentViewer
      items={items}
      index={index}
      onIndexChange={setIndex}
      onClose={props.onClose ?? vi.fn()}
      onDownload={props.onDownload ?? vi.fn()}
    />
  );
}

describe('<AttachmentViewer />', () => {
  beforeEach(() => {
    getAttachmentInlineUrl.mockReset();
    getAttachmentInlineUrl.mockImplementation(async (id: string) => `https://cdn.test/${id}`);
  });
  afterEach(() => vi.restoreAllMocks());

  it('is a labelled modal dialog with focus on the close button', async () => {
    render(<Harness start={0} />);
    const dialog = screen.getByRole('dialog', { name: 'photo.png' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Fermer la visionneuse' })).toHaveFocus();
    expect(await screen.findByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      'https://cdn.test/a1',
    );
  });

  it('closes on Escape without letting the event reach window listeners', () => {
    const onClose = vi.fn();
    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);
    render(<Harness start={0} onClose={onClose} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(windowListener).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowListener);
  });

  it('navigates with the arrow keys (wrapping)', async () => {
    render(<Harness start={0} />);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'clip.mp4' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'sheet.xlsx' })).toBeInTheDocument();
    await act(() => Promise.resolve());
  });

  it('renders a <video> with controls for videos', async () => {
    // Portal on document.body — query the document, not the container.
    render(<Harness start={1} />);
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    const video = document.querySelector('video')!;
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video).toHaveAttribute('src', 'https://cdn.test/a2');
  });

  it('renders PDFs from a blob: URL typed application/pdf, revoked on unmount', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['%PDF-1.7']), { status: 200 }));
    const created: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return 'blob:local/1';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    const { unmount } = render(<Harness start={2} />);
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    const frame = document.querySelector('iframe')!;
    expect(frame).toHaveAttribute('title', 'doc.pdf');
    expect(frame).toHaveAttribute('src', 'blob:local/1');
    expect(fetchSpy).toHaveBeenCalledWith('https://cdn.test/a3', expect.anything());
    expect(created[0]?.type).toBe('application/pdf');
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local/1');
  });

  it('offers a download for other types and always shows the download button', () => {
    const onDownload = vi.fn();
    render(<Harness start={3} onDownload={onDownload} />);
    expect(screen.getByText(/Aperçu indisponible/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /Télécharger/ });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]!);
    expect(onDownload).toHaveBeenCalledWith(items[3]);
    expect(getAttachmentInlineUrl).not.toHaveBeenCalled();
  });
});
