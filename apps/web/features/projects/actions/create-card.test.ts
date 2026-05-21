import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  projectFindFirst: vi.fn(),
  columnFindFirst: vi.fn(),
  cardTemplateFindFirst: vi.fn(),
  cardFindMany: vi.fn(),
  workspaceAccessFindMany: vi.fn(),
  assertCsrf: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    column: { findFirst: mocks.columnFindFirst },
    cardTemplate: { findFirst: mocks.cardTemplateFindFirst },
    card: { findMany: mocks.cardFindMany },
    workspaceAccess: { findMany: mocks.workspaceAccessFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));

import { createCard } from './create-card';

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COLUMN_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PROJECT_DEFAULT_CT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EXPLICIT_CT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function buildFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('_csrf', 'tok');
  fd.set('projectId', PROJECT_ID);
  fd.set('columnId', COLUMN_ID);
  fd.set('title', 'New card');
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'u-1',
    workspaceId: WORKSPACE_ID,
    role: 'admin',
    isSuperAdmin: false,
    email: 'admin@test',
  });
  mocks.workspaceAccessFindMany.mockResolvedValue([]);
  mocks.columnFindFirst.mockResolvedValue({ id: COLUMN_ID, stepChecklist: [] });
  mocks.cardFindMany.mockResolvedValue([]);
  mocks.cardTemplateFindFirst.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      card: {
        create: vi.fn().mockResolvedValue({ id: 'new-card', shortRef: 1, title: 'New card' }),
      },
      checklistItem: { createMany: vi.fn() },
    }),
  );
});

describe('createCard template resolution', () => {
  it('falls back to the workspace isDefault template when nothing else is set', async () => {
    mocks.projectFindFirst.mockResolvedValueOnce({
      id: PROJECT_ID,
      clientId: 'c-1',
      defaultCardTemplateId: null,
    });
    await createCard({ status: 'idle' }, buildFormData());
    const args = mocks.cardTemplateFindFirst.mock.calls[0]![0];
    expect(args.where.workspaceId).toBe(WORKSPACE_ID);
    expect(args.where.isDefault).toBe(true);
    expect(args.where.id).toBeUndefined();
  });

  it('uses the project default when set and no explicit template is sent', async () => {
    mocks.projectFindFirst.mockResolvedValueOnce({
      id: PROJECT_ID,
      clientId: 'c-1',
      defaultCardTemplateId: PROJECT_DEFAULT_CT_ID,
    });
    await createCard({ status: 'idle' }, buildFormData());
    const args = mocks.cardTemplateFindFirst.mock.calls[0]![0];
    expect(args.where.id).toBe(PROJECT_DEFAULT_CT_ID);
    expect(args.where.isDefault).toBeUndefined();
  });

  it('explicit ?templateId wins over the project default', async () => {
    mocks.projectFindFirst.mockResolvedValueOnce({
      id: PROJECT_ID,
      clientId: 'c-1',
      defaultCardTemplateId: PROJECT_DEFAULT_CT_ID,
    });
    await createCard({ status: 'idle' }, buildFormData({ templateId: EXPLICIT_CT_ID }));
    const args = mocks.cardTemplateFindFirst.mock.calls[0]![0];
    expect(args.where.id).toBe(EXPLICIT_CT_ID);
  });
});
