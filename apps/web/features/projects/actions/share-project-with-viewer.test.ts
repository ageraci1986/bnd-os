import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  membershipFindUnique: vi.fn(),
  waFindFirst: vi.fn(),
  waCreate: vi.fn(),
  waDeleteMany: vi.fn(),
  requireUser: vi.fn(),
  workspaceAccessFindMany: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    membership: { findUnique: mocks.membershipFindUnique },
    workspaceAccess: {
      findFirst: mocks.waFindFirst,
      create: mocks.waCreate,
      deleteMany: mocks.waDeleteMany,
      findMany: mocks.workspaceAccessFindMany,
    },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: mocks.getClientIp }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import { shareProjectWithViewer } from './share-project-with-viewer';

const PROJECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'admin-1',
    workspaceId: 'ws-1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'admin@test',
  });
  mocks.projectFindFirst.mockResolvedValue({ id: PROJECT_ID, clientId: 'c-1' });
  mocks.membershipFindUnique.mockResolvedValue({ workspaceId: 'ws-1', role: 'viewer' });
  mocks.workspaceAccessFindMany.mockResolvedValue([]);
});

describe('shareProjectWithViewer', () => {
  it('Admin shares an existing Viewer with a project (creates a row)', async () => {
    mocks.waFindFirst.mockResolvedValueOnce(null);
    const res = await shareProjectWithViewer({
      projectId: PROJECT_ID,
      membershipId: MEMBERSHIP_ID,
      mode: 'share',
      csrfToken: 'tok',
    });
    expect(res).toEqual({ ok: true });
    expect(mocks.waCreate).toHaveBeenCalledOnce();
    const args = mocks.waCreate.mock.calls[0]![0];
    expect(args.data).toMatchObject({
      workspaceId: 'ws-1',
      membershipId: MEMBERSHIP_ID,
      projectId: PROJECT_ID,
      clientId: null,
    });
  });

  it('refuses when target membership is not a Viewer', async () => {
    mocks.membershipFindUnique.mockResolvedValueOnce({ workspaceId: 'ws-1', role: 'user' });
    const res = await shareProjectWithViewer({
      projectId: PROJECT_ID,
      membershipId: MEMBERSHIP_ID,
      mode: 'share',
      csrfToken: 'tok',
    });
    expect(res).toEqual({
      ok: false,
      message: 'Le partage projet ne concerne que les Viewers.',
    });
    expect(mocks.waCreate).not.toHaveBeenCalled();
  });

  it('refuses when project is in a different workspace', async () => {
    mocks.projectFindFirst.mockResolvedValueOnce(null);
    const res = await shareProjectWithViewer({
      projectId: PROJECT_ID,
      membershipId: MEMBERSHIP_ID,
      mode: 'share',
      csrfToken: 'tok',
    });
    expect(res).toEqual({ ok: false, message: 'Projet introuvable.' });
    expect(mocks.waCreate).not.toHaveBeenCalled();
  });

  it('mode=unshare calls deleteMany', async () => {
    const res = await shareProjectWithViewer({
      projectId: PROJECT_ID,
      membershipId: MEMBERSHIP_ID,
      mode: 'unshare',
      csrfToken: 'tok',
    });
    expect(res).toEqual({ ok: true });
    expect(mocks.waDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.waCreate).not.toHaveBeenCalled();
  });
});
