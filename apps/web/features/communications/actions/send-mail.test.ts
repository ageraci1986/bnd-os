import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const rate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({
  checkMailSendRate: (uid: string) => rate(uid),
}));

const integrationFindFirst = vi.hoisted(() => vi.fn());
const emailCreate = vi.hoisted(() => vi.fn());
const emailUpdate = vi.hoisted(() => vi.fn());
const draftDeleteMany = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: integrationFindFirst },
    emailMessage: { create: emailCreate, update: emailUpdate },
    mailDraft: { deleteMany: draftDeleteMany },
    auditLog: { create: auditCreate },
  },
}));

const graphSend = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/integrations/graph', () => ({
  sendViaGraph: (...a: unknown[]) => graphSend(...a),
}));

vi.mock('@/features/integrations/lib/get-valid-access-token', () => ({
  getValidAccessToken: vi.fn(async () => 'AT'),
}));

const imapSend = vi.hoisted(() => vi.fn());
vi.mock('./send-mail-imap', () => ({
  sendViaImapSmtp: (...a: unknown[]) => imapSend(...a),
}));

import { sendMail } from './send-mail';

beforeEach(() => vi.clearAllMocks());

describe('sendMail Graph happy path', () => {
  it('inserts queued row → transitions to sent, deletes draft, audits', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    graphSend.mockResolvedValueOnce({ ok: true });
    const r = await sendMail({
      fromIntegrationId: '00000000-0000-0000-0000-000000000000',
      mode: 'new_mail',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      subject: 'Hi',
      bodyHtml: '<p>Body</p>',
    });
    expect(r).toEqual({ ok: true, emailMessageId: 'e1' });
    expect(emailUpdate).toHaveBeenCalledTimes(2); // sending, then sent
    expect(draftDeleteMany).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({ data: { action: 'mail_sent' } });
  });
});

describe('sendMail rate limit', () => {
  it('returns RATE_LIMIT without touching DB when exhausted', async () => {
    rate.mockResolvedValueOnce({ success: false, window: 'hour', reset: Date.now() + 3600_000 });
    const r = await sendMail({
      fromIntegrationId: '00000000-0000-0000-0000-000000000000',
      mode: 'new_mail',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      subject: 'Hi',
      bodyHtml: '<p>Body</p>',
    });
    expect(r).toEqual({
      ok: false,
      code: 'RATE_LIMIT',
      window: 'hour',
      retryAfterMs: expect.any(Number),
    });
    expect(integrationFindFirst).not.toHaveBeenCalled();
  });
});

describe('sendMail recipient cap', () => {
  it('rejects >20 total recipients', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@ex.com`);
    const r = await sendMail({
      fromIntegrationId: '00000000-0000-0000-0000-000000000000',
      mode: 'new_mail',
      toRecipients: many,
      ccRecipients: [],
      bccRecipients: [],
      subject: 'Hi',
      bodyHtml: '<p>Body</p>',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_MANY_RECIPIENTS');
  });
});

describe('sendMail failure path', () => {
  it('marks row failed + audits, does NOT delete draft', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    graphSend.mockRejectedValueOnce(new Error('graph 429'));
    const r = await sendMail({
      fromIntegrationId: '00000000-0000-0000-0000-000000000000',
      mode: 'new_mail',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      subject: 'Hi',
      bodyHtml: '<p>Body</p>',
    });
    expect(r.ok).toBe(false);
    const failUpdate = emailUpdate.mock.calls.find(
      (c) => (c[0] as { data?: Record<string, unknown> })?.data?.['sendStatus'] === 'failed',
    );
    expect(failUpdate).toBeDefined();
    expect(draftDeleteMany).not.toHaveBeenCalled();
    const auditPayload = auditCreate.mock.calls[0]?.[0] as { data: { action: string } };
    expect(auditPayload.data.action).toBe('mail_send_failed');
  });
});
