import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const updateMany = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { updateMany },
    auditLog: { create: auditCreate },
  },
}));

import { disconnectImapMailbox } from './disconnect-imap-mailbox';

describe('disconnectImapMailbox', () => {
  it('rejects when the integration is not owned by the caller', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await disconnectImapMailbox({
      integrationId: '00000000-0000-0000-0000-000000000000',
    });
    expect(r).toEqual({ ok: false, message: expect.any(String) });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('revokes and clears credentials + UID state and writes audit', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    const r = await disconnectImapMailbox({
      integrationId: '00000000-0000-0000-0000-000000000001',
    });
    expect(r).toEqual({ ok: true });
    const args = updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({
      status: 'revoked',
      encryptedTokens: null,
      imapUidValidity: null,
      imapLastSeenUid: null,
    });
    expect(auditCreate).toHaveBeenCalledOnce();
  });
});
