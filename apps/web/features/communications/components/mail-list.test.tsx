import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MailList } from './mail-list';
import type { MailDTO } from '../lib/mail-dto';

// Vitest hoists vi.mock above all imports — closures must go through
// vi.hoisted() (same convention as compose-panel.test.tsx).
const { markEmailReadSpy, fetchMailBodySpy, retrySendMailSpy, fetchAttachmentBinarySpy } =
  vi.hoisted(() => ({
    markEmailReadSpy: vi.fn(),
    fetchMailBodySpy: vi.fn(),
    retrySendMailSpy: vi.fn(),
    fetchAttachmentBinarySpy: vi.fn(),
  }));

vi.mock('../actions/mark-email-read', () => ({
  markEmailRead: (...a: unknown[]) => markEmailReadSpy(...a),
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
    bodyText: 'Salut.',
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
  markEmailReadSpy.mockReset();
  fetchMailBodySpy.mockReset();
  fetchMailBodySpy.mockResolvedValue({ ok: true, bodyText: 'Salut.', bodyHtmlSanitized: null });
});

describe('<MailList /> attachment badge', () => {
  it('shows the 📎 badge on a row whose mail has attachments', () => {
    render(<MailList mails={[mail({ id: 'm1', hasAttachments: true })]} />);
    expect(screen.getByLabelText('Pièce jointe')).toBeInTheDocument();
  });

  it('does not show the badge on a row without attachments', () => {
    render(<MailList mails={[mail({ id: 'm1', hasAttachments: false })]} />);
    expect(screen.queryByLabelText('Pièce jointe')).not.toBeInTheDocument();
  });
});
