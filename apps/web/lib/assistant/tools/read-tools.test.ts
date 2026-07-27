import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — a plain `const` here
// would be referenced before initialization (see repo convention in
// features/communications/actions/*.test.ts).
const prismaMock = vi.hoisted(() => ({
  card: { count: vi.fn(), findMany: vi.fn() },
  project: { findMany: vi.fn(), findFirst: vi.fn() },
  emailMessage: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  notification: { count: vi.fn() },
  client: { findMany: vi.fn() },
  column: { findMany: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/scope', () => ({
  loadUserScope: vi.fn(async () => ({ kind: 'workspace' as const })),
  scopedProjectWhere: vi.fn(() => ({})),
  scopedCardWhere: vi.fn(() => ({})),
  scopedClientWhere: vi.fn(() => ({})),
}));

import { buildReadTools } from './read-tools';

const ctx = {
  userId: 'u1',
  email: 'a@b.c',
  workspaceId: 'w1',
  role: 'user' as const,
  isSuperAdmin: false,
};

async function execute(name: string, input: unknown): Promise<string> {
  const tools = await buildReadTools(ctx);
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`tool absent: ${name}`);
  return tool.handler(input as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildReadTools', () => {
  it('expose les 7 tools de lecture, aucun gated ni adminOnly', async () => {
    const tools = await buildReadTools(ctx);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_current_datetime',
      'get_project_board',
      'get_today_overview',
      'list_clients',
      'list_projects',
      'read_mail',
      'search_mails',
    ]);
    expect(tools.every((t) => !t.gated && !t.adminOnly)).toBe(true);
  });

  it('get_current_datetime renvoie une date ISO', async () => {
    const out = await execute('get_current_datetime', {});
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('get_today_overview agrège cartes bloquées, dues, mails et notifications', async () => {
    prismaMock.card.count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    prismaMock.emailMessage.count.mockResolvedValue(5);
    prismaMock.notification.count.mockResolvedValue(1);
    const out = JSON.parse(await execute('get_today_overview', {}));
    expect(out).toEqual({
      blockedCards: 2,
      dueTodayCards: 3,
      unreadMails: 5,
      unreadNotifications: 1,
    });
    expect(prismaMock.card.count.mock.calls[0]?.[0]?.where?.workspaceId).toBe('w1');
    expect(prismaMock.emailMessage.count.mock.calls[0]?.[0]?.where?.workspaceId).toBe('w1');
  });

  it('list_projects renvoie les projets scoped', async () => {
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'p1', name: 'Site', client: { name: 'Acme' }, _count: { cards: 4 } },
    ]);
    const out = JSON.parse(await execute('list_projects', {}));
    expect(out[0]).toEqual({ id: 'p1', name: 'Site', client: 'Acme', cards: 4 });
    expect(prismaMock.project.findMany.mock.calls[0]?.[0]?.where?.workspaceId).toBe('w1');
  });

  it('get_project_board renvoie colonnes et cartes, ou une erreur si projet introuvable', async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const out = await execute('get_project_board', {
      projectId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa',
    });
    expect(out).toContain('introuvable');
  });

  it('search_mails filtre par texte sur sujet/expéditeur', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([
      {
        id: 'm1',
        subject: 'Devis',
        fromEmail: 'marc@acme.com',
        fromName: 'Marc',
        receivedAt: new Date('2026-07-26T10:00:00Z'),
        isRead: false,
        folder: 'inbox',
      },
    ]);
    const out = JSON.parse(await execute('search_mails', { query: 'devis' }));
    expect(out[0].subject).toBe('Devis');
    const where = prismaMock.emailMessage.findMany.mock.calls[0]?.[0]?.where;
    expect(where.workspaceId).toBe('w1');
    expect(where.deletedAt).toBeNull();
  });

  it('read_mail renvoie le corps stocké ou signale un corps non chargé', async () => {
    prismaMock.emailMessage.findFirst.mockResolvedValue({
      id: 'm1',
      subject: 'Devis',
      fromEmail: 'marc@acme.com',
      fromName: 'Marc',
      toRecipients: ['moi@bnd.co'],
      receivedAt: new Date(),
      bodyText: null,
      bodyHtmlSanitized: null,
      isRead: true,
    });
    const out = await execute('read_mail', { emailId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' });
    expect(out).toContain('non chargé');
  });

  it('erreur Prisma → message utilisateur, pas de fuite du message brut', async () => {
    prismaMock.project.findMany.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:5432'));
    const out = await execute('list_projects', {});
    expect(out).not.toContain('ECONNREFUSED');
    expect(out.toLowerCase()).toContain('erreur');
  });
});
