import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  cardFindFirst: vi.fn(),
  cardUpdate: vi.fn(),
  cardFindMany: vi.fn(),
  columnFindMany: vi.fn(),
  workspaceAccessFindMany: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    card: {
      findFirst: mocks.cardFindFirst,
      update: mocks.cardUpdate,
      findMany: mocks.cardFindMany,
    },
    column: { findMany: mocks.columnFindMany },
    workspaceAccess: { findMany: mocks.workspaceAccessFindMany },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));

import { uncompleteCard } from './uncomplete-card';

const CARD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PREV_COL = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const LAST_COL = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'u-1',
    workspaceId: 'ws-1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'admin@test',
  });
  mocks.workspaceAccessFindMany.mockResolvedValue([]);
  mocks.columnFindMany.mockResolvedValue([{ id: PREV_COL }, { id: LAST_COL }]);
  mocks.cardFindMany.mockResolvedValue([]);
});

describe('uncompleteCard', () => {
  it('moves the card to the previous user column when in the last one', async () => {
    mocks.cardFindFirst.mockResolvedValueOnce({
      id: CARD_ID,
      projectId: PROJECT_ID,
      columnId: LAST_COL,
      project: { clientId: 'c-1' },
    });
    mocks.cardUpdate.mockResolvedValue({ id: CARD_ID });
    const res = await uncompleteCard({ cardId: CARD_ID });
    expect(res).toEqual({ ok: true, newColumnId: PREV_COL });
    const args = mocks.cardUpdate.mock.calls[0]![0];
    expect(args.data.columnId).toBe(PREV_COL);
    expect(typeof args.data.position).toBe('number');
  });

  it('refuses if the card is NOT in the last user column', async () => {
    mocks.cardFindFirst.mockResolvedValueOnce({
      id: CARD_ID,
      projectId: PROJECT_ID,
      columnId: PREV_COL,
      project: { clientId: 'c-1' },
    });
    const res = await uncompleteCard({ cardId: CARD_ID });
    expect(res).toEqual({
      ok: false,
      message: "La carte n'est pas dans la dernière colonne.",
    });
    expect(mocks.cardUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the project has only one user column', async () => {
    mocks.columnFindMany.mockResolvedValueOnce([{ id: LAST_COL }]);
    mocks.cardFindFirst.mockResolvedValueOnce({
      id: CARD_ID,
      projectId: PROJECT_ID,
      columnId: LAST_COL,
      project: { clientId: 'c-1' },
    });
    const res = await uncompleteCard({ cardId: CARD_ID });
    expect(res).toEqual({ ok: false, message: 'Pas de colonne précédente disponible.' });
    expect(mocks.cardUpdate).not.toHaveBeenCalled();
  });

  it('refuses Viewer', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: 'v-1',
      workspaceId: 'ws-1',
      role: 'viewer',
      isSuperAdmin: false,
      email: 'v@test',
    });
    const res = await uncompleteCard({ cardId: CARD_ID });
    expect(res.ok).toBe(false);
    expect(mocks.cardFindFirst).not.toHaveBeenCalled();
  });
});
