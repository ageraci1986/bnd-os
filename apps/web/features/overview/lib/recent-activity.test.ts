import { describe, expect, it, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  cardFindMany: vi.fn(),
  commentFindMany: vi.fn(),
  projectFindMany: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    card: { findMany: m.cardFindMany },
    comment: { findMany: m.commentFindMany },
    project: { findMany: m.projectFindMany },
  },
}));

import { getRecentActivity, mergeActivity, relativeShort, toActor } from './recent-activity';

const at = (iso: string) => new Date(iso);
const marie = { firstName: 'Marie', lastName: 'Duval', email: 'marie@studio.test' };

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
});

describe('getRecentActivity', () => {
  it('merges created cards, completed cards, comments and projects, newest first', async () => {
    m.cardFindMany.mockImplementation((args: { where: { completedAt?: unknown } }) =>
      Promise.resolve(
        args.where.completedAt
          ? [
              {
                id: 'k2',
                title: 'Moodboard',
                projectId: 'p1',
                completedAt: at('2026-11-13T08:00:00Z'),
              },
            ]
          : [
              {
                id: 'k1',
                title: 'Hero web',
                projectId: 'p1',
                createdAt: at('2026-11-13T07:00:00Z'),
                createdBy: marie,
              },
            ],
      ),
    );
    m.commentFindMany.mockResolvedValue([
      {
        id: 'c1',
        createdAt: at('2026-11-13T09:00:00Z'),
        author: marie,
        card: { id: 'k1', title: 'Hero web', projectId: 'p1' },
      },
    ]);
    m.projectFindMany.mockResolvedValue([
      { id: 'p1', name: 'Refonte site', createdAt: at('2026-11-12T10:00:00Z') },
    ]);

    const res = await getRecentActivity({ workspaceId: 'ws-1', take: 3 });

    expect(res.map((i) => [i.kind, i.title, i.actor?.name ?? null, i.cardId])).toEqual([
      ['comment_added', 'Hero web', 'Marie', 'k1'],
      ['card_completed', 'Moodboard', null, 'k2'],
      ['card_created', 'Hero web', 'Marie', 'k1'],
    ]);
  });

  it('scopes every stream to the workspace, client and user scope and never selects comment bodies', async () => {
    m.cardFindMany.mockResolvedValue([]);
    m.commentFindMany.mockResolvedValue([]);
    m.projectFindMany.mockResolvedValue([]);
    await getRecentActivity({
      workspaceId: 'ws-1',
      clientId: 'cl-1',
      scope: { kind: 'restricted', clientIds: ['cl-1'], projectIds: [] },
    });
    const project = { workspaceId: 'ws-1', deletedAt: null, archivedAt: null, clientId: 'cl-1' };
    for (const call of m.cardFindMany.mock.calls) {
      expect(call[0].where).toMatchObject({ workspaceId: 'ws-1', deletedAt: null, project });
    }
    const comment = m.commentFindMany.mock.calls[0]![0];
    expect(comment.where).toMatchObject({
      deletedAt: null,
      card: { workspaceId: 'ws-1', project },
    });
    expect(comment.select.body).toBeUndefined();
    expect(m.projectFindMany.mock.calls[0]![0].where).toMatchObject(project);
  });
});

describe('helpers', () => {
  it('toActor builds a display name and initials, falling back to the e-mail local part', () => {
    expect(toActor(marie)).toEqual({ name: 'Marie', initials: 'MD' });
    expect(toActor({ firstName: null, lastName: null, email: 'lea.p@x.test' })).toEqual({
      name: 'lea.p',
      initials: 'LE',
    });
    expect(toActor(null)).toBeNull();
  });

  it('mergeActivity sorts newest first and truncates', () => {
    const item = (key: string, iso: string) => ({
      key,
      kind: 'card_created' as const,
      at: at(iso),
      actor: null,
      title: key,
      projectId: 'p',
      cardId: null,
    });
    const merged = mergeActivity(
      [
        [item('a', '2026-11-10T00:00:00Z')],
        [item('b', '2026-11-12T00:00:00Z'), item('c', '2026-11-11T00:00:00Z')],
      ],
      2,
    );
    expect(merged.map((i) => i.key)).toEqual(['b', 'c']);
  });

  it('relativeShort formats minutes, hours, yesterday and dates', () => {
    const now = at('2026-11-13T12:00:00Z');
    expect(relativeShort(at('2026-11-13T11:59:40Z'), now)).toBe("à l'instant");
    expect(relativeShort(at('2026-11-13T11:46:00Z'), now)).toBe('14 min');
    expect(relativeShort(at('2026-11-13T09:00:00Z'), now)).toBe('3 h');
    expect(relativeShort(at('2026-11-12T10:00:00Z'), now)).toBe('hier');
    expect(relativeShort(at('2026-11-09T10:00:00Z'), now)).toBe('9 nov.');
  });
});
