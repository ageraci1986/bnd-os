import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  cardFindFirst: vi.fn(),
  cardUpdate: vi.fn(),
  columnFindMany: vi.fn(),
  workspaceAccessFindMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    card: { findFirst: mocks.cardFindFirst, update: mocks.cardUpdate },
    column: { findMany: mocks.columnFindMany },
    workspaceAccess: { findMany: mocks.workspaceAccessFindMany },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { toggleCardCompletion } from './toggle-card-completion';

const CARD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LAST_COL = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const MIDDLE_COL = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

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
  mocks.columnFindMany.mockResolvedValue([{ id: MIDDLE_COL }, { id: LAST_COL }]);
});

describe('toggleCardCompletion', () => {
  it('refuses Viewer role', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: 'v-1',
      workspaceId: 'ws-1',
      role: 'viewer',
      isSuperAdmin: false,
      email: 'v@test',
    });
    const res = await toggleCardCompletion({ cardId: CARD_ID, completed: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('lecture seule');
    expect(mocks.cardUpdate).not.toHaveBeenCalled();
  });

  it('refuses cards not in the last user column', async () => {
    mocks.cardFindFirst.mockResolvedValueOnce({
      id: CARD_ID,
      projectId: PROJECT_ID,
      columnId: MIDDLE_COL,
      completedAt: null,
      project: { clientId: 'c-1' },
    });
    const res = await toggleCardCompletion({ cardId: CARD_ID, completed: true });
    expect(res).toEqual({
      ok: false,
      message: 'Le marquage « terminé » n’est disponible que pour les cartes en dernière colonne.',
    });
    expect(mocks.cardUpdate).not.toHaveBeenCalled();
  });

  it('marks a card as completed when in the last user column', async () => {
    mocks.cardFindFirst.mockResolvedValueOnce({
      id: CARD_ID,
      projectId: PROJECT_ID,
      columnId: LAST_COL,
      completedAt: null,
      project: { clientId: 'c-1' },
    });
    const res = await toggleCardCompletion({ cardId: CARD_ID, completed: true });
    expect(res.ok).toBe(true);
    expect(mocks.cardUpdate).toHaveBeenCalledOnce();
    const args = mocks.cardUpdate.mock.calls[0]![0];
    expect(args.where).toEqual({ id: CARD_ID });
    expect(args.data.completedAt).toBeInstanceOf(Date);
  });

  it('clears completion when toggling off', async () => {
    const past = new Date('2026-05-01T10:00:00Z');
    mocks.cardFindFirst.mockResolvedValueOnce({
      id: CARD_ID,
      projectId: PROJECT_ID,
      columnId: LAST_COL,
      completedAt: past,
      project: { clientId: 'c-1' },
    });
    const res = await toggleCardCompletion({ cardId: CARD_ID, completed: false });
    expect(res).toEqual({ ok: true, completedAt: null });
    const args = mocks.cardUpdate.mock.calls[0]![0];
    expect(args.data.completedAt).toBeNull();
  });

  it('is idempotent when state already matches', async () => {
    const past = new Date('2026-05-01T10:00:00Z');
    mocks.cardFindFirst.mockResolvedValueOnce({
      id: CARD_ID,
      projectId: PROJECT_ID,
      columnId: LAST_COL,
      completedAt: past,
      project: { clientId: 'c-1' },
    });
    const res = await toggleCardCompletion({ cardId: CARD_ID, completed: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.completedAt).toBe(past.toISOString());
    expect(mocks.cardUpdate).not.toHaveBeenCalled();
  });
});
