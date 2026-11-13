import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadUserScope: vi.fn(),
  cardFindFirst: vi.fn(),
  membershipFindFirst: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@nexushub/db', () => ({
  prisma: {
    card: { findFirst: mocks.cardFindFirst },
    membership: { findFirst: mocks.membershipFindFirst },
    cardAssignee: { upsert: mocks.upsert, update: mocks.update },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/auth/scope', () => ({ loadUserScope: mocks.loadUserScope }));

import { addCardAssignee, updateCardAssigneeRaci } from './card-assignees';

const CARD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.requireUser.mockResolvedValue({ userId: 'me', workspaceId: WS, role: 'user' });
  mocks.loadUserScope.mockResolvedValue({ kind: 'workspace' });
  mocks.cardFindFirst.mockResolvedValue({ id: CARD, projectId: 'p', project: { clientId: 'c' } });
  mocks.membershipFindFirst.mockResolvedValue({ id: 'm' });
});

describe('addCardAssignee — plusieurs personnes par rôle', () => {
  it.each(['responsible', 'approver'] as const)('accepte un 2e %s', async (raci) => {
    mocks.upsert.mockResolvedValue({});
    await expect(addCardAssignee({ cardId: CARD, userId: USER, raci })).resolves.toEqual({
      ok: true,
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { cardId: CARD, userId: USER, raci } }),
    );
  });

  it('ne traduit plus P2002 en message d’unicité R/A', async () => {
    mocks.upsert.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(
      addCardAssignee({ cardId: CARD, userId: USER, raci: 'responsible' }),
    ).rejects.toThrow('unique');
  });
});

describe('updateCardAssigneeRaci', () => {
  it('P2025 → assignation introuvable', async () => {
    mocks.update.mockRejectedValue(Object.assign(new Error('nf'), { code: 'P2025' }));
    await expect(
      updateCardAssigneeRaci({ cardId: CARD, userId: USER, raci: 'approver' }),
    ).resolves.toEqual({ ok: false, message: 'Assignation introuvable.' });
  });

  it('passe un 2e approver sans message d’unicité', async () => {
    mocks.update.mockResolvedValue({});
    await expect(
      updateCardAssigneeRaci({ cardId: CARD, userId: USER, raci: 'approver' }),
    ).resolves.toEqual({ ok: true });
  });
});
