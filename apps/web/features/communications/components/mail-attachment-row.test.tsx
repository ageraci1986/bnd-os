import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MailAttachmentRow } from './mail-attachment-row';
import type { MailAttachmentDto } from '../lib/mail-dto';

// Vitest hoists vi.mock above all imports — anything the factory closes
// over must come from vi.hoisted() (mirrors compose-panel.test.tsx).
const { fetchAttachmentBinarySpy, notifySpy } = vi.hoisted(() => ({
  fetchAttachmentBinarySpy: vi.fn(),
  notifySpy: vi.fn(),
}));

vi.mock('../actions/fetch-attachment', () => ({
  fetchAttachmentBinary: (...a: unknown[]) => fetchAttachmentBinarySpy(...a),
}));

vi.mock('@/features/shell/components/toaster', () => ({
  notify: (...a: unknown[]) => notifySpy(...a),
}));

function attachment(overrides: Partial<MailAttachmentDto> = {}): MailAttachmentDto {
  return {
    id: 'a1',
    filename: 'rapport.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2_411_724,
    scanStatus: null,
    ...overrides,
  };
}

beforeEach(() => {
  fetchAttachmentBinarySpy.mockReset();
  notifySpy.mockReset();
});

describe('<MailAttachmentRow />', () => {
  it('renders the filename, icon and formatted size', () => {
    render(<MailAttachmentRow attachment={attachment()} />);
    expect(screen.getByText(/rapport\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/2\.3 MB/)).toBeInTheDocument();
  });

  it('shows a Télécharger button for a not-yet-fetched (null scanStatus) attachment', () => {
    render(<MailAttachmentRow attachment={attachment({ scanStatus: null })} />);
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeInTheDocument();
  });

  it('shows a Télécharger button for an already-clean attachment', () => {
    render(<MailAttachmentRow attachment={attachment({ scanStatus: 'clean' })} />);
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeInTheDocument();
  });

  it('shows a blocked warning with no download button for a dirty attachment', () => {
    render(<MailAttachmentRow attachment={attachment({ scanStatus: 'dirty' })} />);
    expect(screen.getByText(/Fichier bloqué \(menace détectée\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Télécharger' })).not.toBeInTheDocument();
  });

  it('shows a blocked warning with no download button for a scan_failed attachment', () => {
    render(<MailAttachmentRow attachment={attachment({ scanStatus: 'scan_failed' })} />);
    expect(screen.getByText(/Analyse échouée/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Télécharger' })).not.toBeInTheDocument();
  });

  it('clicking Télécharger calls fetchAttachmentBinary and navigates via an anchor click on success', async () => {
    fetchAttachmentBinarySpy.mockResolvedValue({
      ok: true,
      signedUrl: 'https://storage.example/signed/a1',
      expiresAt: Date.now() + 300_000,
      filename: 'rapport.pdf',
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<MailAttachmentRow attachment={attachment()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger' }));

    await waitFor(() =>
      expect(fetchAttachmentBinarySpy).toHaveBeenCalledWith({ attachmentId: 'a1' }),
    );
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(notifySpy).not.toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it('shows an inline error and a DIRTY-specific toast when the lazy fetch rejects the file', async () => {
    fetchAttachmentBinarySpy.mockResolvedValue({
      ok: false,
      code: 'DIRTY',
      message: 'Cette pièce jointe a été rejetée par le scan antivirus.',
    });

    render(<MailAttachmentRow attachment={attachment()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger' }));

    await waitFor(() =>
      expect(
        screen.getByText('Cette pièce jointe a été rejetée par le scan antivirus.'),
      ).toBeInTheDocument(),
    );
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'error',
        message: expect.stringContaining('rejeté par le scan antivirus'),
      }),
    );
  });

  it('shows a generic toast for a non-DIRTY failure code', async () => {
    fetchAttachmentBinarySpy.mockResolvedValue({
      ok: false,
      code: 'FETCH_FAILED',
      message: 'Récupération échouée.',
    });

    render(<MailAttachmentRow attachment={attachment()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger' }));

    await waitFor(() =>
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          message: expect.stringContaining('Échec du téléchargement'),
        }),
      ),
    );
  });
});
