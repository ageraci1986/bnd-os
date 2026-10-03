import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserVerified: vi.fn(),
  projectFindFirst: vi.fn(),
  projectUpdate: vi.fn(),
  workspaceAccessFindMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst, update: mocks.projectUpdate },
    workspaceAccess: { findMany: mocks.workspaceAccessFindMany },
  },
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));
vi.mock('@/lib/auth', () => ({ requireUserVerified: mocks.requireUserVerified }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { renameProject } from './rename-project';

const PROJECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const admin = {
  userId: 'admin-1',
  workspaceId: 'ws-1',
  role: 'admin',
  isSuperAdmin: false,
  email: 'a@t',
};

beforeEach(() => {
  for (const f of Object.values(mocks)) f.mockReset();
  mocks.workspaceAccessFindMany.mockResolvedValue([]);
});

describe('renameProject', () => {
  it('renames, returns the stored name and revalidates', async () => {
    mocks.requireUserVerified.mockResolvedValue(admin);
    mocks.projectFindFirst
      .mockResolvedValueOnce({ id: PROJECT_ID, clientId: 'c-1', startDate: null, endDate: null })
      .mockResolvedValueOnce({
        name: 'Nouveau nom',
        description: null,
        startDate: null,
        endDate: null,
      });
    mocks.projectUpdate.mockResolvedValue({});

    const res = await renameProject({ projectId: PROJECT_ID, name: '  Nouveau nom ' });

    expect(res).toEqual({ ok: true, name: 'Nouveau nom' });
    expect(mocks.projectUpdate.mock.calls[0]![0].data).toEqual({ name: 'Nouveau nom' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/projects');
  });

  it('rejects an empty name without touching the DB', async () => {
    mocks.requireUserVerified.mockResolvedValue(admin);
    const res = await renameProject({ projectId: PROJECT_ID, name: '   ' });
    expect(res.ok).toBe(false);
    expect(mocks.projectUpdate).not.toHaveBeenCalled();
  });

  it('refuses a Viewer', async () => {
    mocks.requireUserVerified.mockResolvedValue({ ...admin, role: 'viewer' });
    const res = await renameProject({ projectId: PROJECT_ID, name: 'X' });
    expect(res).toEqual({
      ok: false,
      message: 'Action indisponible : rôle Viewer en lecture seule.',
    });
    expect(mocks.projectUpdate).not.toHaveBeenCalled();
  });

  it('returns a friendly message when the project is gone (NotFoundError)', async () => {
    mocks.requireUserVerified.mockResolvedValue(admin);
    mocks.projectFindFirst.mockResolvedValueOnce(null);
    const res = await renameProject({ projectId: PROJECT_ID, name: 'X' });
    expect(res).toEqual({ ok: false, message: 'Projet introuvable.' });
    expect(mocks.projectUpdate).not.toHaveBeenCalled();
  });
});
