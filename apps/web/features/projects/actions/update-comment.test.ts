import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  commentFindFirst: vi.fn(),
  commentUpdate: vi.fn(),
  assertCsrf: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    comment: { findFirst: mocks.commentFindFirst, update: mocks.commentUpdate },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));

import { updateComment } from './update-comment';

const COMMENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CARD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PROJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AUTHOR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: AUTHOR,
    workspaceId: 'ws-1',
    role: 'user',
    isSuperAdmin: false,
    email: 'a@test',
  });
  mocks.assertCsrf.mockResolvedValue(undefined);
  mocks.commentFindFirst.mockResolvedValue({
    id: COMMENT,
    authorId: AUTHOR,
    cardId: CARD,
    deletedAt: null,
    card: { projectId: PROJECT, workspaceId: 'ws-1' },
  });
  mocks.commentUpdate.mockResolvedValue({ id: COMMENT });
});

function fd(body = 'updated', commentId = COMMENT): FormData {
  const f = new FormData();
  f.set('commentId', commentId);
  f.set('body', body);
  return f;
}

describe('updateComment', () => {
  it('updates the comment body when the caller is the author', async () => {
    const res = await updateComment({ status: 'idle' }, fd('new body'));
    expect(res.status).toBe('success');
    const args = mocks.commentUpdate.mock.calls[0]![0];
    expect(args.data.body).toBe('new body');
    expect(args.where.id).toBe(COMMENT);
  });

  it('refuses when the caller is NOT the author', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: OTHER,
      workspaceId: 'ws-1',
      role: 'user',
      isSuperAdmin: false,
      email: 'o@test',
    });
    const res = await updateComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the comment has been soft-deleted', async () => {
    mocks.commentFindFirst.mockResolvedValueOnce({
      id: COMMENT,
      authorId: AUTHOR,
      cardId: CARD,
      deletedAt: new Date(),
      card: { projectId: PROJECT, workspaceId: 'ws-1' },
    });
    const res = await updateComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses empty body', async () => {
    const res = await updateComment({ status: 'idle' }, fd('   '));
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses cross-workspace tampering', async () => {
    mocks.commentFindFirst.mockResolvedValueOnce({
      id: COMMENT,
      authorId: AUTHOR,
      cardId: CARD,
      deletedAt: null,
      card: { projectId: PROJECT, workspaceId: 'other-ws' },
    });
    const res = await updateComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });
});
