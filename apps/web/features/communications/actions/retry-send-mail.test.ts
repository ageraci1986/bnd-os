import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));
const findFirst = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({ prisma: { emailMessage: { findFirst } } }));

const sendMail = vi.hoisted(() => vi.fn());
vi.mock('./send-mail', () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));

import { retrySendMail } from './retry-send-mail';

describe('retrySendMail', () => {
  it('rejects when the row is not failed or not owned', async () => {
    findFirst.mockResolvedValueOnce(null);
    const r = await retrySendMail({ emailMessageId: '00000000-0000-0000-0000-000000000000' });
    expect(r).toEqual({ ok: false, code: 'NOT_FOUND', message: expect.any(String) });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('resubmits with the persisted recipients/subject/body when found', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'e1',
      integrationId: 'i1',
      subject: 'Hi',
      bodyHtmlSanitized: '<p>Body</p>',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
    });
    sendMail.mockResolvedValueOnce({ ok: true, emailMessageId: 'e2' });
    const r = await retrySendMail({ emailMessageId: '00000000-0000-0000-0000-000000000000' });
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      fromIntegrationId: 'i1',
      mode: 'new_mail',
      subject: 'Hi',
      toRecipients: ['you@ex.com'],
    });
    expect(r).toEqual({ ok: true, emailMessageId: 'e2' });
  });
});
