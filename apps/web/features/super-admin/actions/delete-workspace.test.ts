import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  workspaceFindUnique: vi.fn(),
  workspaceDelete: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    workspace: { findUnique: mocks.workspaceFindUnique, delete: mocks.workspaceDelete },
  },
}));
vi.mock('@/lib/auth', () => ({ requireSuperAdmin: mocks.requireSuperAdmin }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: mocks.getClientIp }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import { deleteWorkspace } from './delete-workspace';

const WS_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function fd(input: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(input)) f.set(k, v);
  return f;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireSuperAdmin.mockResolvedValue({
    userId: 'sa-1',
    workspaceId: 'ws-anywhere',
    role: 'admin',
    isSuperAdmin: true,
    email: 'sa@platform',
  });
  mocks.workspaceFindUnique.mockResolvedValue({
    id: WS_ID,
    name: 'Acme Agency',
    slug: 'acme-agency',
    _count: { memberships: 7 },
  });
  mocks.workspaceDelete.mockResolvedValue({ id: WS_ID });
});

describe('deleteWorkspace', () => {
  it('deletes when the typed name matches exactly', async () => {
    const result = await deleteWorkspace(
      { status: 'idle' },
      fd({ workspaceId: WS_ID, confirmationName: 'Acme Agency' }),
    );
    expect(result).toEqual({ status: 'success', deletedName: 'Acme Agency' });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workspace_deleted',
        workspaceId: WS_ID,
        data: expect.objectContaining({ name: 'Acme Agency', memberCount: 7 }),
      }),
    );
    expect(mocks.workspaceDelete).toHaveBeenCalledWith({ where: { id: WS_ID } });
  });

  it('refuses when the typed name has different casing', async () => {
    const result = await deleteWorkspace(
      { status: 'idle' },
      fd({ workspaceId: WS_ID, confirmationName: 'acme agency' }),
    );
    expect(result.status).toBe('error');
    expect(mocks.workspaceDelete).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses when the typed name has surrounding whitespace', async () => {
    const result = await deleteWorkspace(
      { status: 'idle' },
      fd({ workspaceId: WS_ID, confirmationName: '  Acme Agency  ' }),
    );
    expect(result.status).toBe('error');
    expect(mocks.workspaceDelete).not.toHaveBeenCalled();
  });

  it('refuses unknown workspace id', async () => {
    mocks.workspaceFindUnique.mockResolvedValueOnce(null);
    const result = await deleteWorkspace(
      { status: 'idle' },
      fd({ workspaceId: WS_ID, confirmationName: 'Acme Agency' }),
    );
    expect(result).toEqual({ status: 'error', message: 'Workspace introuvable.' });
    expect(mocks.workspaceDelete).not.toHaveBeenCalled();
  });

  it('audits BEFORE the delete (so the trail survives the cascade)', async () => {
    const order: string[] = [];
    mocks.recordAudit.mockImplementationOnce(async () => {
      order.push('audit');
    });
    mocks.workspaceDelete.mockImplementationOnce(async () => {
      order.push('delete');
      return { id: WS_ID };
    });
    await deleteWorkspace(
      { status: 'idle' },
      fd({ workspaceId: WS_ID, confirmationName: 'Acme Agency' }),
    );
    expect(order).toEqual(['audit', 'delete']);
  });
});
