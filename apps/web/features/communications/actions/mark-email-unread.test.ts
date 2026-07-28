import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  setMailStateCore: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/features/communications/lib/mail-state-core', () => ({
  setMailStateCore: mocks.setMailStateCore,
}));

import { markEmailUnread } from './mark-email-unread';

const CTX = {
  userId: 'U1',
  workspaceId: 'W1',
  role: 'user',
  isSuperAdmin: false,
  email: 'a@b.c',
};

const MAIL_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue(CTX);
});

describe('markEmailUnread', () => {
  it('delegates to setMailStateCore with a single-id array and op "unread"', async () => {
    mocks.setMailStateCore.mockResolvedValue({ ok: true, affected: 1, skipped: 0 });
    const res = await markEmailUnread({ emailId: MAIL_ID });
    expect(res).toEqual({ ok: true, affected: 1 });
    expect(mocks.setMailStateCore).toHaveBeenCalledWith(CTX, {
      mailIds: [MAIL_ID],
      op: 'unread',
    });
  });

  it('propagates affected:0 when the mail belongs to another member’s mailbox (owner-only core)', async () => {
    mocks.setMailStateCore.mockResolvedValue({ ok: true, affected: 0, skipped: 1 });
    const res = await markEmailUnread({ emailId: MAIL_ID });
    expect(res).toEqual({ ok: true, affected: 0 });
  });

  it('returns the core failure message on ok:false', async () => {
    mocks.setMailStateCore.mockResolvedValue({ ok: false, message: 'Lecture seule.' });
    const res = await markEmailUnread({ emailId: MAIL_ID });
    expect(res).toEqual({ ok: false, message: 'Lecture seule.' });
  });

  it('rejects invalid id without calling the core', async () => {
    const res = await markEmailUnread({ emailId: 'not-a-uuid' });
    expect(res).toEqual({ ok: false, message: 'Identifiant invalide.' });
    expect(mocks.setMailStateCore).not.toHaveBeenCalled();
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });
});
