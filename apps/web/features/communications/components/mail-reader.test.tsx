import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MailReader } from './mail-reader';
import type { MailDTO } from '../lib/mail-dto';

// Vitest hoists vi.mock above all imports — closures must go through
// vi.hoisted() (same convention as compose-panel.test.tsx).
const { fetchMailBodySpy, retrySendMailSpy, fetchAttachmentBinarySpy } = vi.hoisted(() => ({
  fetchMailBodySpy: vi.fn(),
  retrySendMailSpy: vi.fn(),
  fetchAttachmentBinarySpy: vi.fn(),
}));

vi.mock('../actions/fetch-mail-body', () => ({
  fetchMailBody: (...a: unknown[]) => fetchMailBodySpy(...a),
}));

vi.mock('../actions/retry-send-mail', () => ({
  retrySendMail: (...a: unknown[]) => retrySendMailSpy(...a),
}));

vi.mock('../actions/fetch-attachment', () => ({
  fetchAttachmentBinary: (...a: unknown[]) => fetchAttachmentBinarySpy(...a),
}));

vi.mock('@/features/shell/components/toaster', () => ({
  notify: vi.fn(),
}));

function mail(overrides: Partial<MailDTO> = {}): MailDTO {
  return {
    id: 'm1',
    subject: 'Bonjour',
    fromEmail: 'client@example.com',
    fromName: 'Client Example',
    preview: 'Salut,',
    receivedAt: new Date('2026-07-16T10:00:00.000Z').toISOString(),
    isRead: true,
    client: null,
    toRecipients: [],
    ccRecipients: [],
    bodyHtmlSanitized: null,
    bodyText: 'Salut, voir pièce jointe.',
    mailboxLabel: null,
    externalId: 'ext-1',
    integrationId: 'int-1',
    sendStatus: null,
    sendError: null,
    hasAttachments: false,
    attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  fetchMailBodySpy.mockReset();
  retrySendMailSpy.mockReset();
  fetchAttachmentBinarySpy.mockReset();
  fetchMailBodySpy.mockResolvedValue({
    ok: true,
    bodyText: 'Salut, voir pièce jointe.',
    bodyHtmlSanitized: null,
  });
});

describe('<MailReader />', () => {
  it('renders no attachments section when the mail has none', async () => {
    render(<MailReader mail={mail()} />);
    await waitFor(() => expect(fetchMailBodySpy).toHaveBeenCalled());
    expect(screen.queryByText(/Pièces jointes/)).not.toBeInTheDocument();
  });

  it('renders the attachments section with a count and a row per attachment', async () => {
    render(
      <MailReader
        mail={mail({
          hasAttachments: true,
          attachments: [
            {
              id: 'a1',
              filename: 'rapport.pdf',
              contentType: 'application/pdf',
              sizeBytes: 2048,
              scanStatus: 'clean',
            },
            {
              id: 'a2',
              filename: 'virus.exe',
              contentType: 'application/x-msdownload',
              sizeBytes: 512,
              scanStatus: 'dirty',
            },
          ],
        })}
      />,
    );
    await waitFor(() => expect(fetchMailBodySpy).toHaveBeenCalled());

    expect(screen.getByText('📎 Pièces jointes (2)')).toBeInTheDocument();
    expect(screen.getByText(/rapport\.pdf/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeInTheDocument();
    expect(screen.getByText(/virus\.exe/)).toBeInTheDocument();
    expect(screen.getByText(/Fichier bloqué \(menace détectée\)/)).toBeInTheDocument();
  });
});
