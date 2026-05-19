import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  commentFindFirst: vi.fn(),
  commentUpdate: vi.fn(),
  assertCsrf: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    comment: { findFirst: mocks.commentFindFirst, update: mocks.commentUpdate },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { deleteComment } from './delete-comment';

const COMMENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CARD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PROJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AUTHOR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ADMIN = 'aaaaaaaa-1111-2222-3333-444444444444';

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

function fd(commentId = COMMENT): FormData {
  const f = new FormData();
  f.set('commentId', commentId);
  return f;
}

describe('deleteComment', () => {
  it('soft-deletes when the caller is the author', async () => {
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success');
    const args = mocks.commentUpdate.mock.calls[0]![0];
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('soft-deletes when the caller is a workspace Admin', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: ADMIN,
      workspaceId: 'ws-1',
      role: 'admin',
      isSuperAdmin: false,
      email: 'admin@test',
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success');
    expect(mocks.commentUpdate).toHaveBeenCalled();
  });

  it('refuses non-author, non-admin', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: OTHER,
      workspaceId: 'ws-1',
      role: 'user',
      isSuperAdmin: false,
      email: 'o@test',
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses non-author Viewer', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: OTHER,
      workspaceId: 'ws-1',
      role: 'viewer',
      isSuperAdmin: false,
      email: 'v@test',
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses cross-workspace deletion even by admin', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: ADMIN,
      workspaceId: 'ws-1',
      role: 'admin',
      isSuperAdmin: false,
      email: 'admin@test',
    });
    mocks.commentFindFirst.mockResolvedValueOnce({
      id: COMMENT,
      authorId: AUTHOR,
      cardId: CARD,
      deletedAt: null,
      card: { projectId: PROJECT, workspaceId: 'other-ws' },
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent on already-deleted rows', async () => {
    mocks.commentFindFirst.mockResolvedValueOnce({
      id: COMMENT,
      authorId: AUTHOR,
      cardId: CARD,
      deletedAt: new Date(),
      card: { projectId: PROJECT, workspaceId: 'ws-1' },
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });
});
