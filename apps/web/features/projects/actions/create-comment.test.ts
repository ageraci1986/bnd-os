import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  cardFindFirst: vi.fn(),
  commentCreate: vi.fn(),
  notificationCreate: vi.fn(),
  notificationUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  loadUserScope: vi.fn(),
  emailSend: vi.fn(),
  revalidatePath: vi.fn(),
  assertCsrf: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    card: { findFirst: mocks.cardFindFirst },
    comment: { create: mocks.commentCreate },
    notification: { create: mocks.notificationCreate, update: mocks.notificationUpdate },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/auth/scope', () => ({ loadUserScope: mocks.loadUserScope }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/email', () => ({ getEmail: () => ({ send: mocks.emailSend }) }));
vi.mock('@/lib/env', () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://nexushub.test' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { createComment } from './create-comment';

const CARD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AUTHOR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ASSIGNEE_A = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ASSIGNEE_B = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

function ctx(role: 'admin' | 'user' | 'viewer', userId = AUTHOR) {
  return {
    userId,
    workspaceId: WS,
    role,
    isSuperAdmin: false,
    email: `${role}@test`,
  };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue(ctx('user'));
  mocks.loadUserScope.mockResolvedValue({ kind: 'workspace' });
  mocks.assertCsrf.mockResolvedValue(undefined);
  mocks.cardFindFirst.mockResolvedValue({
    id: CARD,
    projectId: PROJECT,
    workspaceId: WS,
    shortRef: 42,
    title: 'Carte de test',
    project: { name: 'Projet X', clientId: 'client-1', client: { name: 'Acme' } },
    assignees: [
      { userId: ASSIGNEE_A, user: { firstName: 'A', lastName: 'A', email: 'a@test' } },
      { userId: AUTHOR, user: { firstName: 'Author', lastName: 'A', email: 'author@test' } },
      { userId: ASSIGNEE_B, user: { firstName: 'B', lastName: 'B', email: 'b@test' } },
    ],
  });
  mocks.userFindUnique.mockResolvedValue({
    firstName: 'Author',
    lastName: 'A',
    email: 'author@test',
  });
  mocks.commentCreate.mockResolvedValue({ id: 'new-comment-id' });
  mocks.notificationCreate.mockResolvedValue({ id: 'notif-id' });
  mocks.emailSend.mockResolvedValue({ id: 'msg-id', delivered: true });
});

function fd(body = 'hello world', cardId = CARD): FormData {
  const f = new FormData();
  f.set('cardId', cardId);
  f.set('body', body);
  f.set('csrf', 'token');
  return f;
}

describe('createComment', () => {
  it('creates the comment and returns ok', async () => {
    const res = await createComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success');
    expect(mocks.commentCreate).toHaveBeenCalledOnce();
    const args = mocks.commentCreate.mock.calls[0]![0];
    expect(args.data.body).toBe('hello world');
    expect(args.data.cardId).toBe(CARD);
    expect(args.data.authorId).toBe(AUTHOR);
  });

  it('accepts Viewer role', async () => {
    mocks.requireUser.mockResolvedValueOnce(ctx('viewer', AUTHOR));
    const res = await createComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success');
  });

  it('refuses empty body', async () => {
    const res = await createComment({ status: 'idle' }, fd('   '));
    expect(res.status).toBe('error');
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it('refuses body over 10000 chars', async () => {
    const res = await createComment({ status: 'idle' }, fd('x'.repeat(10001)));
    expect(res.status).toBe('error');
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it('refuses if card not found in workspace', async () => {
    mocks.cardFindFirst.mockResolvedValueOnce(null);
    await expect(createComment({ status: 'idle' }, fd())).rejects.toThrow();
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it('refuses when card is out of scope (restricted)', async () => {
    mocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted',
      clientIds: [],
      projectIds: ['other-project'],
    });
    const res = await createComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it('sends an email to each assignee except the author', async () => {
    await createComment({ status: 'idle' }, fd('hi'));
    expect(mocks.emailSend).toHaveBeenCalledTimes(2);
    const recipients = mocks.emailSend.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients).toContain('a@test');
    expect(recipients).toContain('b@test');
    expect(recipients).not.toContain('author@test');
  });

  it('persists a Notification row per recipient (sentAt set on success)', async () => {
    await createComment({ status: 'idle' }, fd('hi'));
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(2);
    expect(mocks.notificationUpdate).toHaveBeenCalledTimes(2);
    const updateCalls = mocks.notificationUpdate.mock.calls;
    for (const call of updateCalls) {
      const args = call[0] as { data: { sentAt: Date } };
      expect(args.data.sentAt).toBeInstanceOf(Date);
    }
  });

  it('does not block when one email recipient fails (Promise.allSettled)', async () => {
    mocks.emailSend
      .mockRejectedValueOnce(new Error('Resend 500'))
      .mockResolvedValueOnce({ id: 'ok', delivered: true });
    const res = await createComment({ status: 'idle' }, fd('hi'));
    expect(res.status).toBe('success');
    expect(mocks.notificationUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not send email when card has no other assignees', async () => {
    mocks.cardFindFirst.mockResolvedValueOnce({
      id: CARD,
      projectId: PROJECT,
      workspaceId: WS,
      shortRef: 42,
      title: 'solo',
      project: { name: 'P', clientId: 'client-1', client: { name: 'C' } },
      assignees: [
        { userId: AUTHOR, user: { firstName: 'A', lastName: 'A', email: 'author@test' } },
      ],
    });
    const res = await createComment({ status: 'idle' }, fd('hi'));
    expect(res.status).toBe('success');
    expect(mocks.emailSend).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it('revalidates the project path', async () => {
    await createComment({ status: 'idle' }, fd('hi'));
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT}/list`);
  });
});
