import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireUserVerified: vi.fn(),
  projectFindFirst: vi.fn(),
  projectUpdate: vi.fn(),
  workspaceAccessFindMany: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((p: string) => {
    throw new Error(`REDIRECT:${p}`);
  }),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst, update: mocks.projectUpdate },
    workspaceAccess: { findMany: mocks.workspaceAccessFindMany },
  },
}));
vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
  requireUserVerified: mocks.requireUserVerified,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { deleteProject } from './delete-project';

const PROJECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.redirect.mockImplementation((p: string) => {
    throw new Error(`REDIRECT:${p}`);
  });
  mocks.workspaceAccessFindMany.mockResolvedValue([]);
});

describe('deleteProject', () => {
  it('refuses when the actor is a Viewer (even with scope access)', async () => {
    mocks.requireUserVerified.mockResolvedValue({
      userId: 'viewer-1',
      workspaceId: 'ws-1',
      role: 'viewer',
      isSuperAdmin: false,
      email: 'viewer@test',
    });
    const res = await deleteProject({ projectId: PROJECT_ID });
    expect(res).toEqual({ ok: false, message: 'Action réservée aux Admins et Users.' });
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
    expect(mocks.projectUpdate).not.toHaveBeenCalled();
  });

  it('Admin can soft-delete the project', async () => {
    mocks.requireUserVerified.mockResolvedValue({
      userId: 'admin-1',
      workspaceId: 'ws-1',
      role: 'admin',
      isSuperAdmin: false,
      email: 'admin@test',
    });
    mocks.projectFindFirst.mockResolvedValue({ id: PROJECT_ID, clientId: 'c-1' });
    mocks.projectUpdate.mockResolvedValue({ id: PROJECT_ID });

    await expect(deleteProject({ projectId: PROJECT_ID })).rejects.toThrow('REDIRECT:/projects');
    expect(mocks.projectUpdate).toHaveBeenCalledOnce();
    const args = mocks.projectUpdate.mock.calls[0]![0];
    expect(args.where).toEqual({ id: PROJECT_ID });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });
});
