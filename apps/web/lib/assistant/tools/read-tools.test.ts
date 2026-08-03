import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — a plain `const` here
// would be referenced before initialization (see repo convention in
// features/communications/actions/*.test.ts).
const prismaMock = vi.hoisted(() => ({
  card: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  project: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  emailMessage: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  notification: { count: vi.fn() },
  client: { findMany: vi.fn() },
  column: { findMany: vi.fn() },
  membership: { count: vi.fn(), findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));

const scopeMocks = vi.hoisted(() => ({
  loadUserScope: vi.fn(async () => ({ kind: 'workspace' as const })),
  scopedProjectWhere: vi.fn(() => ({})),
  scopedCardWhere: vi.fn(() => ({})),
  scopedClientWhere: vi.fn(() => ({})),
}));
vi.mock('@/lib/auth/scope', () => scopeMocks);

const fetchMailBodyMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/communications/actions/fetch-mail-body', () => ({
  fetchMailBody: fetchMailBodyMock,
}));

import { buildReadTools } from './read-tools';
import * as overviewCore from '@/lib/assistant/overview-core';

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
  it('expose les 11 tools de lecture, aucun gated ni adminOnly', async () => {
    const tools = await buildReadTools(ctx);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'find_projects',
      'get_card',
      'get_card_details',
      'get_current_datetime',
      'get_project_board',
      'get_team_members',
      'get_today_overview',
      'list_clients',
      'list_projects',
      'read_mail',
      'search_mails',
    ]);
    expect(tools.every((t) => !t.gated && !t.adminOnly)).toBe(true);
  });

  it('get_current_datetime renvoie iso UTC + heure de Paris', async () => {
    const out = JSON.parse(await execute('get_current_datetime', {}));
    expect(out.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(typeof out.parisLocal).toBe('string');
    expect(out.parisLocal.length).toBeGreaterThan(0);
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
    const notifWhere = prismaMock.notification.count.mock.calls[0]?.[0]?.where;
    expect(notifWhere?.workspaceId).toBe('w1');
    expect(notifWhere?.userId).toBe('u1');
    expect(scopeMocks.scopedCardWhere).toHaveBeenCalled();
  });

  it("get_today_overview borne « dû aujourd'hui » sur minuit UTC (convention card-filter)", async () => {
    prismaMock.card.count.mockResolvedValue(0);
    prismaMock.emailMessage.count.mockResolvedValue(0);
    prismaMock.notification.count.mockResolvedValue(0);
    await execute('get_today_overview', {});
    const dueWhere = prismaMock.card.count.mock.calls[1]?.[0]?.where?.dueDate;
    const start: Date = dueWhere.gte;
    const end: Date = dueWhere.lt;
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('get_today_overview délègue à loadTodayOverview (overview-core.ts, partagé avec l’accueil de /assistant)', async () => {
    // Preuve de délégation (Plan 4 Task 3) : le tool n'agrège plus lui-même —
    // il appelle le core partagé et sérialise EXACTEMENT ce qu'il renvoie.
    // Les deux tests précédents (agrégation, borne minuit UTC) prouvent déjà
    // l'iso-comportement sans modification ; celui-ci pin l'architecture.
    const spy = vi.spyOn(overviewCore, 'loadTodayOverview').mockResolvedValue({
      blockedCards: 7,
      dueTodayCards: 8,
      unreadMails: 9,
      unreadNotifications: 10,
    });
    const out = JSON.parse(await execute('get_today_overview', {}));
    expect(spy).toHaveBeenCalledWith(ctx);
    expect(out).toEqual({
      blockedCards: 7,
      dueTodayCards: 8,
      unreadMails: 9,
      unreadNotifications: 10,
    });
    spy.mockRestore();
  });

  it('list_projects renvoie les projets scoped dans une enveloppe { total, projects }', async () => {
    prismaMock.project.count.mockResolvedValue(1);
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'p1', name: 'Site', client: { name: 'Acme' }, _count: { cards: 4 } },
    ]);
    const out = JSON.parse(await execute('list_projects', {}));
    expect(out.total).toBe(1);
    expect(out.truncated).toBe(false);
    expect(out.projects[0]).toEqual({ id: 'p1', name: 'Site', client: 'Acme', cards: 4 });
    expect(prismaMock.project.findMany.mock.calls[0]?.[0]?.where?.workspaceId).toBe('w1');
    expect(scopeMocks.scopedProjectWhere).toHaveBeenCalled();
    // count() porte le MÊME where que findMany (même scope, même workspace).
    expect(prismaMock.project.count.mock.calls[0]?.[0]?.where).toEqual(
      prismaMock.project.findMany.mock.calls[0]?.[0]?.where,
    );
  });

  it('list_projects : enveloppe { total, projects }, truncated quand le plafond de 50 est atteint', async () => {
    prismaMock.project.count.mockResolvedValue(63);
    prismaMock.project.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        id: `p${i}`,
        name: `Projet ${i}`,
        client: { name: 'Acme' },
        _count: { cards: 0 },
      })),
    );
    const out = JSON.parse(await execute('list_projects', {}));
    expect(out.total).toBe(63);
    expect(out.truncated).toBe(true);
    expect(out.projects).toHaveLength(50);
  });

  it('cherche via unaccent et ne renvoie que les projets du workspace visibles par le scope', async () => {
    const PROJECT_ID = '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa';
    prismaMock.$queryRaw.mockResolvedValue([{ id: PROJECT_ID }]);
    prismaMock.project.findMany.mockResolvedValue([
      {
        id: PROJECT_ID,
        name: 'Liste de course',
        client: { name: 'Perso' },
        _count: { cards: 3 },
      },
    ]);
    const out = JSON.parse(await execute('find_projects', { query: 'liste de courses' }));
    expect(out.projects).toEqual([
      { id: PROJECT_ID, name: 'Liste de course', client: 'Perso', cards: 3 },
    ]);
    expect(out.truncated).toBeUndefined();
    const call = prismaMock.project.findMany.mock.calls[0]?.[0];
    expect(call?.where?.workspaceId).toBe('w1');
    expect(call?.where?.deletedAt).toBeNull();
    expect(call?.where?.AND).toEqual([{ id: { in: [PROJECT_ID] } }, {}]);
    expect(call?.take).toBe(10);
    expect(scopeMocks.scopedProjectWhere).toHaveBeenCalled();
  });

  it('find_projects : le scope restricted est intersecté avec les candidats, jamais écrasé', async () => {
    // Régression : `scopedProjectWhere` restricted « project-only » renvoie
    // `{ id: { in: [...] } }` — spreadé à plat après `id: { in: candidates } }`,
    // il l'écrasait et renvoyait tout le scope sans rapport avec la query.
    const PROJECT_ID = '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa';
    scopeMocks.scopedProjectWhere.mockReturnValueOnce({ id: { in: ['scope-p1'] } });
    prismaMock.$queryRaw.mockResolvedValue([{ id: PROJECT_ID }]);
    prismaMock.project.findMany.mockResolvedValue([]);
    await execute('find_projects', { query: 'course' });
    const where = prismaMock.project.findMany.mock.calls[0]?.[0]?.where;
    expect(where?.AND).toEqual([{ id: { in: [PROJECT_ID] } }, { id: { in: ['scope-p1'] } }]);
  });

  it('find_projects : zéro candidat → liste vide sans requête findMany', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const out = JSON.parse(await execute('find_projects', { query: 'introuvable' }));
    expect(out).toEqual({ projects: [] });
    expect(prismaMock.project.findMany).not.toHaveBeenCalled();
  });

  it('find_projects : truncated=true quand le plafond de 10 candidats est atteint', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }));
    prismaMock.$queryRaw.mockResolvedValue(ids);
    prismaMock.project.findMany.mockResolvedValue(
      ids.map((c) => ({
        id: c.id,
        name: 'Projet',
        client: { name: 'Acme' },
        _count: { cards: 0 },
      })),
    );
    const out = JSON.parse(await execute('find_projects', { query: 'projet' }));
    expect(out.projects).toHaveLength(10);
    expect(out.truncated).toBe(true);
  });

  it('find_projects : la requête SQL est un tagged template paramétré ($queryRaw, pas $queryRawUnsafe)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    await execute('find_projects', { query: 'course' });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
    const call = prismaMock.$queryRaw.mock.calls[0] ?? [];
    const firstArg = call[0] as TemplateStringsArray;
    expect(Array.isArray(firstArg)).toBe(true);
    expect(Array.isArray(firstArg.raw)).toBe(true);
    // Les valeurs (workspaceId + query) passent en paramètres, jamais dans le texte SQL.
    const params = call.slice(1);
    expect(params).toContain('w1');
    expect(params).toContain('course');
  });

  it('get_project_board renvoie colonnes et cartes, ou une erreur si projet introuvable', async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const out = await execute('get_project_board', {
      projectId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa',
    });
    expect(out).toContain('introuvable');
    const where = prismaMock.project.findFirst.mock.calls[0]?.[0]?.where;
    expect(where?.workspaceId).toBe('w1');
    expect(scopeMocks.scopedProjectWhere).toHaveBeenCalled();
  });

  it("get_project_board : le scope restricted est intersecté avec l'id demandé, jamais écrasé", async () => {
    // Régression (Plan 1) : même écrasement que find_projects — un restricted
    // « project-only » demandant n'importe quel uuid recevait le board du
    // premier projet de son scope.
    scopeMocks.scopedProjectWhere.mockReturnValueOnce({ id: { in: ['scope-p1'] } });
    prismaMock.project.findFirst.mockResolvedValue(null);
    await execute('get_project_board', { projectId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' });
    const where = prismaMock.project.findFirst.mock.calls[0]?.[0]?.where;
    expect(where?.AND).toEqual([
      { id: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' },
      { id: { in: ['scope-p1'] } },
    ]);
    expect(where?.workspaceId).toBe('w1');
    expect(where?.deletedAt).toBeNull();
  });

  it('get_project_board borne les cartes à 100 par colonne, expose totalCards et signale la troncature', async () => {
    const fullColumn = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      title: `Carte ${i}`,
      dueDate: null,
    }));
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'p1',
      name: 'Site',
      columns: [
        {
          id: 'col1',
          name: 'À faire',
          isBlockedSystem: false,
          cards: fullColumn,
          _count: { cards: 140 },
        },
        { id: 'col2', name: 'Bloqué', isBlockedSystem: true, cards: [], _count: { cards: 0 } },
      ],
    });
    const out = JSON.parse(
      await execute('get_project_board', { projectId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out.columns[0].totalCards).toBe(140);
    expect(out.columns[0].truncated).toBe(true);
    expect(out.columns[0].cards).toHaveLength(100);
    expect(out.columns[1].totalCards).toBe(0);
    expect(out.columns[1].truncated).toBeUndefined();
    const columnSelect = prismaMock.project.findFirst.mock.calls[0]?.[0]?.select?.columns?.select;
    expect(columnSelect?.cards?.take).toBe(100);
    // Filtre du _count aligné sur celui des cartes réellement récupérées
    // (deletedAt/archivedAt) — sinon totalCards compterait des cartes
    // supprimées/archivées jamais visibles dans `cards`.
    expect(columnSelect?._count?.select?.cards?.where).toEqual({
      deletedAt: null,
      archivedAt: null,
    });
  });

  it("get_project_board ne signale pas de troncature quand le total réel n'excède pas 100 malgré 100 cartes récupérées", async () => {
    // Régression : `cards.length === 100` seul ne suffit plus — il faut aussi
    // `totalCards > 100`. Un projet avec exactement 100 cartes ne doit pas
    // afficher « liste partielle » à tort.
    const fullColumn = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      title: `Carte ${i}`,
      dueDate: null,
    }));
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'p1',
      name: 'Site',
      columns: [
        {
          id: 'col1',
          name: 'À faire',
          isBlockedSystem: false,
          cards: fullColumn,
          _count: { cards: 100 },
        },
      ],
    });
    const out = JSON.parse(
      await execute('get_project_board', { projectId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out.columns[0].totalCards).toBe(100);
    expect(out.columns[0].truncated).toBeUndefined();
  });

  it('list_clients renvoie les clients scoped du workspace', async () => {
    prismaMock.client.findMany.mockResolvedValue([
      { id: 'cl1', name: 'Acme', initials: 'AC', _count: { projects: 2, contacts: 3 } },
    ]);
    const out = JSON.parse(await execute('list_clients', {}));
    expect(out[0]).toEqual({ id: 'cl1', name: 'Acme', initials: 'AC', projects: 2, contacts: 3 });
    expect(prismaMock.client.findMany.mock.calls[0]?.[0]?.where?.workspaceId).toBe('w1');
    expect(scopeMocks.scopedClientWhere).toHaveBeenCalled();
  });

  it('search_mails filtre par texte sur sujet/expéditeur', async () => {
    prismaMock.emailMessage.count.mockResolvedValue(1);
    prismaMock.emailMessage.findMany.mockResolvedValue([
      {
        id: 'm1',
        subject: 'Devis',
        fromEmail: 'marc@acme.com',
        fromName: 'Marc',
        receivedAt: new Date('2026-07-26T10:00:00Z'),
        isRead: false,
        folder: 'inbox',
        integrationId: 'int-1',
      },
    ]);
    const out = JSON.parse(await execute('search_mails', { query: 'devis' }));
    expect(out.mails[0].subject).toBe('Devis');
    expect(out.total).toBe(1);
    expect(out.offset).toBe(0);
    const where = prismaMock.emailMessage.findMany.mock.calls[0]?.[0]?.where;
    expect(where.workspaceId).toBe('w1');
    expect(where.deletedAt).toBeNull();
  });

  it('search_mails : renvoie { total, offset, mails } et transmet skip', async () => {
    prismaMock.emailMessage.count.mockResolvedValue(88);
    prismaMock.emailMessage.findMany.mockResolvedValue([]);
    const out = JSON.parse(await execute('search_mails', { offset: 25, limit: 25 }));
    expect(out.total).toBe(88);
    expect(out.offset).toBe(25);
    expect(Array.isArray(out.mails)).toBe(true);
    expect(prismaMock.emailMessage.findMany.mock.calls[0]?.[0]?.skip).toBe(25);
    // le count porte le MÊME where que le findMany
    expect(prismaMock.emailMessage.count.mock.calls[0]?.[0]?.where).toEqual(
      prismaMock.emailMessage.findMany.mock.calls[0]?.[0]?.where,
    );
  });

  it('search_mails exclut les mails archivés (archivedAt: null)', async () => {
    prismaMock.emailMessage.count.mockResolvedValue(0);
    prismaMock.emailMessage.findMany.mockResolvedValue([]);
    await execute('search_mails', { query: 'devis' });
    const where = prismaMock.emailMessage.findMany.mock.calls[0]?.[0]?.where;
    expect(where.archivedAt).toBeNull();
  });

  it('search_mails select `integrationId` (nécessaire au deep-link du widget mail)', async () => {
    prismaMock.emailMessage.count.mockResolvedValue(0);
    prismaMock.emailMessage.findMany.mockResolvedValue([]);
    await execute('search_mails', { query: 'devis' });
    const select = prismaMock.emailMessage.findMany.mock.calls[0]?.[0]?.select;
    expect(select).toEqual({
      id: true,
      subject: true,
      fromEmail: true,
      fromName: true,
      receivedAt: true,
      isRead: true,
      folder: true,
      integrationId: true,
    });
  });

  it('search_mails renvoie `integrationId` dans le JSON de sortie de chaque mail', async () => {
    prismaMock.emailMessage.count.mockResolvedValue(1);
    prismaMock.emailMessage.findMany.mockResolvedValue([
      {
        id: 'm1',
        subject: 'Devis',
        fromEmail: 'marc@acme.com',
        fromName: 'Marc',
        receivedAt: new Date('2026-07-26T10:00:00Z'),
        isRead: false,
        folder: 'inbox',
        integrationId: 'int-1',
      },
    ]);
    const out = JSON.parse(await execute('search_mails', { query: 'devis' }));
    expect(out.mails).toEqual([
      {
        id: 'm1',
        subject: 'Devis',
        fromEmail: 'marc@acme.com',
        fromName: 'Marc',
        receivedAt: '2026-07-26T10:00:00.000Z',
        isRead: false,
        folder: 'inbox',
        integrationId: 'int-1',
      },
    ]);
  });

  it('read_mail charge le corps paresseusement via fetchMailBody quand absent en DB', async () => {
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
    fetchMailBodyMock.mockResolvedValue({
      ok: true,
      bodyText: 'Corps récupéré via IMAP',
      bodyHtmlSanitized: null,
    });
    const out = JSON.parse(
      await execute('read_mail', { emailId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out.body).toBe('Corps récupéré via IMAP');
    expect(fetchMailBodyMock).toHaveBeenCalledWith({
      emailId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa',
    });
  });

  it('read_mail renvoie le message d’erreur de fetchMailBody quand le chargement échoue', async () => {
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
    fetchMailBodyMock.mockResolvedValue({
      ok: false,
      message: 'La boîte IMAP source est déconnectée.',
    });
    const out = await execute('read_mail', { emailId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' });
    expect(out).toBe('Erreur : La boîte IMAP source est déconnectée.');
  });

  it('read_mail utilise le HTML sanitisé en cache (strip balises) sans rappeler fetchMailBody', async () => {
    prismaMock.emailMessage.findFirst.mockResolvedValue({
      id: 'm1',
      subject: 'Devis',
      fromEmail: 'marc@acme.com',
      fromName: 'Marc',
      toRecipients: ['moi@bnd.co'],
      receivedAt: new Date(),
      bodyText: null,
      bodyHtmlSanitized: '<p>Contenu</p>',
      isRead: true,
    });
    const out = JSON.parse(
      await execute('read_mail', { emailId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out.body).toContain('Contenu');
    expect(out.body).not.toContain('<p>');
    expect(fetchMailBodyMock).not.toHaveBeenCalled();
  });

  it('read_mail ne rappelle pas fetchMailBody quand le corps est déjà présent en DB', async () => {
    prismaMock.emailMessage.findFirst.mockResolvedValue({
      id: 'm1',
      subject: 'Devis',
      fromEmail: 'marc@acme.com',
      fromName: 'Marc',
      toRecipients: ['moi@bnd.co'],
      receivedAt: new Date(),
      bodyText: 'Déjà en cache',
      bodyHtmlSanitized: null,
      isRead: true,
    });
    const out = JSON.parse(
      await execute('read_mail', { emailId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out.body).toBe('Déjà en cache');
    expect(fetchMailBodyMock).not.toHaveBeenCalled();
  });

  it('read_mail est gated sur le propriétaire de la boîte (convention fetch-mail-body)', async () => {
    prismaMock.emailMessage.findFirst.mockResolvedValue(null);
    const out = await execute('read_mail', { emailId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' });
    expect(out).toContain('autre membre');
    const where = prismaMock.emailMessage.findFirst.mock.calls[0]?.[0]?.where;
    expect(where?.workspaceId).toBe('w1');
    expect(where?.integration).toEqual({ workspaceId: 'w1', ownerUserId: 'u1' });
  });

  it('read_mail tronque le corps à 5000 caractères', async () => {
    prismaMock.emailMessage.findFirst.mockResolvedValue({
      id: 'm1',
      subject: 'Long',
      fromEmail: 'marc@acme.com',
      fromName: 'Marc',
      toRecipients: ['moi@bnd.co'],
      receivedAt: new Date(),
      bodyText: 'x'.repeat(6000),
      bodyHtmlSanitized: null,
      isRead: true,
    });
    const out = JSON.parse(
      await execute('read_mail', { emailId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out.body.endsWith(' […corps tronqué]')).toBe(true);
    expect(out.body.length).toBe(5000 + ' […corps tronqué]'.length);
  });

  it('get_team_members renvoie userId/email/name/role + total, scoped au workspace', async () => {
    prismaMock.membership.count.mockResolvedValue(2);
    prismaMock.membership.findMany.mockResolvedValue([
      {
        role: 'admin',
        user: { id: 'u1', email: 'a@acme.com', firstName: 'Ada', lastName: 'Lovelace' },
      },
      { role: 'user', user: { id: 'u2', email: 'b@acme.com', firstName: null, lastName: null } },
    ]);
    const out = JSON.parse(await execute('get_team_members', {}));
    expect(out.total).toBe(2);
    expect(out.members).toEqual([
      { userId: 'u1', email: 'a@acme.com', name: 'Ada Lovelace', role: 'admin' },
      { userId: 'u2', email: 'b@acme.com', name: null, role: 'user' },
    ]);
    expect(out.truncated).toBeUndefined();
    expect(prismaMock.membership.findMany.mock.calls[0]?.[0]?.where?.workspaceId).toBe('w1');
    expect(prismaMock.membership.findMany.mock.calls[0]?.[0]?.orderBy).toEqual({
      user: { email: 'asc' },
    });
    // count() porte le MÊME where que findMany.
    expect(prismaMock.membership.count.mock.calls[0]?.[0]?.where).toEqual(
      prismaMock.membership.findMany.mock.calls[0]?.[0]?.where,
    );
  });

  it('get_team_members signale la troncature quand la limite de 50 est atteinte, total au-delà', async () => {
    prismaMock.membership.count.mockResolvedValue(51);
    prismaMock.membership.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        role: 'user',
        user: { id: `u${i}`, email: `m${i}@acme.com`, firstName: null, lastName: null },
      })),
    );
    const out = JSON.parse(await execute('get_team_members', {}));
    expect(out.total).toBe(51);
    expect(out.members).toHaveLength(50);
    expect(out.truncated).toBe(true);
    expect(prismaMock.membership.findMany.mock.calls[0]?.[0]?.take).toBe(50);
  });

  it("get_team_members ne signale pas de troncature quand le workspace compte EXACTEMENT 50 membres (le total réel n'excède pas le plafond)", async () => {
    // Régression : `members.length === 50` seul ne suffit pas — il faut aussi
    // `total > 50`, sinon un workspace de pile 50 membres serait annoncé
    // « liste partielle » à tort (même borne que get_project_board).
    prismaMock.membership.count.mockResolvedValue(50);
    prismaMock.membership.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        role: 'user',
        user: { id: `u${i}`, email: `m${i}@acme.com`, firstName: null, lastName: null },
      })),
    );
    const out = JSON.parse(await execute('get_team_members', {}));
    expect(out.total).toBe(50);
    expect(out.members).toHaveLength(50);
    expect(out.truncated).toBeUndefined();
  });

  it('get_card renvoie le détail scoped, ou une erreur si carte introuvable', async () => {
    prismaMock.card.findFirst.mockResolvedValue(null);
    const out = await execute('get_card', { cardId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' });
    expect(out).toContain('introuvable');
    const where = prismaMock.card.findFirst.mock.calls[0]?.[0]?.where;
    expect(where?.workspaceId).toBe('w1');
    expect(where?.deletedAt).toBeNull();
    expect(scopeMocks.scopedCardWhere).toHaveBeenCalled();
  });

  it('get_card renvoie titre, colonne, projet, assignés, checklist et totalItems (sans fuite de _count)', async () => {
    prismaMock.card.findFirst.mockResolvedValue({
      id: 'c1',
      title: 'Créer le devis',
      description: null,
      dueDate: null,
      shortRef: 42,
      column: { id: 'col1', name: 'À faire', isBlockedSystem: false },
      project: { id: 'p1', name: 'Site' },
      assignees: [{ userId: 'u1', raci: 'responsible' }],
      checklistItems: [{ title: 'Étape 1', isChecked: false }],
      _count: { checklistItems: 1 },
    });
    const out = JSON.parse(await execute('get_card', { cardId: 'c1' }));
    expect(out.title).toBe('Créer le devis');
    expect(out.assignees).toEqual([{ userId: 'u1', raci: 'responsible' }]);
    expect(out.checklistItems).toEqual([{ title: 'Étape 1', isChecked: false }]);
    expect(out.totalItems).toBe(1);
    expect(out.checklistTruncated).toBeUndefined();
    // Le champ brut `_count` de Prisma ne doit jamais fuiter tel quel.
    expect(out._count).toBeUndefined();
    const select = prismaMock.card.findFirst.mock.calls[0]?.[0]?.select;
    expect(select?._count?.select?.checklistItems).toBe(true);
  });

  it('get_card tronque la description à 5000 caractères', async () => {
    prismaMock.card.findFirst.mockResolvedValue({
      id: 'c1',
      title: 'Longue',
      description: 'x'.repeat(6000),
      dueDate: null,
      shortRef: 1,
      column: { id: 'col1', name: 'À faire', isBlockedSystem: false },
      project: { id: 'p1', name: 'Site' },
      assignees: [],
      checklistItems: [],
      _count: { checklistItems: 0 },
    });
    const out = JSON.parse(await execute('get_card', { cardId: 'c1' }));
    expect(out.description.endsWith(' […tronqué]')).toBe(true);
    expect(out.description.length).toBe(5000 + ' […tronqué]'.length);
  });

  it('get_card signale la troncature de checklist quand la limite de 50 est atteinte, totalItems porte le vrai total', async () => {
    prismaMock.card.findFirst.mockResolvedValue({
      id: 'c1',
      title: 'Grosse checklist',
      description: null,
      dueDate: null,
      shortRef: 1,
      column: { id: 'col1', name: 'À faire', isBlockedSystem: false },
      project: { id: 'p1', name: 'Site' },
      assignees: [],
      checklistItems: Array.from({ length: 50 }, (_, i) => ({
        title: `Item ${i}`,
        isChecked: false,
      })),
      _count: { checklistItems: 73 },
    });
    const out = JSON.parse(await execute('get_card', { cardId: 'c1' }));
    expect(out.checklistTruncated).toBe(true);
    expect(out.totalItems).toBe(73);
    const select = prismaMock.card.findFirst.mock.calls[0]?.[0]?.select;
    expect(select?.checklistItems?.take).toBe(50);
  });

  it('get_card : checklist de PILE 50 items → pas de troncature ; 51 → troncature (borne sur le total réel)', async () => {
    // Régression : `checklistItems.length === 50` seul ne suffit pas — il faut
    // que le total réel (_count) excède le plafond, sinon une carte de pile
    // 50 items serait annoncée tronquée à tort.
    const fullChecklist = Array.from({ length: 50 }, (_, i) => ({
      title: `Item ${i}`,
      isChecked: false,
    }));
    const cardBase = {
      id: 'c1',
      title: 'Checklist pleine',
      description: null,
      dueDate: null,
      shortRef: 1,
      column: { id: 'col1', name: 'À faire', isBlockedSystem: false },
      project: { id: 'p1', name: 'Site' },
      assignees: [],
      checklistItems: fullChecklist,
    };

    prismaMock.card.findFirst.mockResolvedValueOnce({
      ...cardBase,
      _count: { checklistItems: 50 },
    });
    const exactAtCap = JSON.parse(await execute('get_card', { cardId: 'c1' }));
    expect(exactAtCap.totalItems).toBe(50);
    expect(exactAtCap.checklistTruncated).toBeUndefined();

    prismaMock.card.findFirst.mockResolvedValueOnce({
      ...cardBase,
      _count: { checklistItems: 51 },
    });
    const oneAboveCap = JSON.parse(await execute('get_card', { cardId: 'c1' }));
    expect(oneAboveCap.totalItems).toBe(51);
    expect(oneAboveCap.checklistTruncated).toBe(true);
  });

  it('get_card_details renvoie le JSON complet (échéance, colonne, assignés, checklist ordonnée avec ids)', async () => {
    prismaMock.card.findFirst.mockResolvedValue({
      id: 'c1',
      title: 'Créer le devis',
      description: 'Devis pour le client',
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      column: { name: 'À faire' },
      assignees: [{ raci: 'responsible', user: { firstName: 'Ada' } }],
      checklistItems: [
        { id: 'i2', title: 'Étape 2', isChecked: false },
        { id: 'i1', title: 'Étape 1', isChecked: true },
      ],
    });
    const out = JSON.parse(
      await execute('get_card_details', { cardId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out).toEqual({
      id: 'c1',
      title: 'Créer le devis',
      description: 'Devis pour le client',
      due: '2026-08-01',
      column: 'À faire',
      assignees: [{ name: 'Ada', raci: 'responsible' }],
      checklist: [
        { id: 'i2', title: 'Étape 2', checked: false },
        { id: 'i1', title: 'Étape 1', checked: true },
      ],
    });
    // Ordre renvoyé tel quel par Prisma (orderBy position asc) — on vérifie
    // que le select a bien demandé cet ordre plutôt que de re-trier ici.
    // Mêmes bornes que get_card : cap 50 items côté requête.
    const select = prismaMock.card.findFirst.mock.calls[0]?.[0]?.select;
    expect(select?.checklistItems?.orderBy).toEqual({ position: 'asc' });
    expect(select?.checklistItems?.take).toBe(50);
  });

  it('get_card_details tronque la description à 5000 caractères (même borne que get_card)', async () => {
    prismaMock.card.findFirst.mockResolvedValue({
      id: 'c1',
      title: 'Longue',
      description: 'x'.repeat(6000),
      dueDate: null,
      column: { name: 'À faire' },
      assignees: [],
      checklistItems: [],
    });
    const out = JSON.parse(
      await execute('get_card_details', { cardId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out.description.endsWith(' […tronqué]')).toBe(true);
    expect(out.description.length).toBe(5000 + ' […tronqué]'.length);
  });

  it('get_card_details signale la troncature de checklist quand la limite de 50 est atteinte', async () => {
    prismaMock.card.findFirst.mockResolvedValue({
      id: 'c1',
      title: 'Grosse checklist',
      description: null,
      dueDate: null,
      column: { name: 'À faire' },
      assignees: [],
      checklistItems: Array.from({ length: 50 }, (_, i) => ({
        id: `i${i}`,
        title: `Item ${i}`,
        isChecked: false,
      })),
    });
    const out = JSON.parse(
      await execute('get_card_details', { cardId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out.checklist).toHaveLength(50);
    expect(out.checklistTruncated).toBe(true);
  });

  it('get_card oriente vers get_card_details pour les ids de checklist (description anti-doublon)', async () => {
    const tools = await buildReadTools(ctx);
    const getCard = tools.find((t) => t.name === 'get_card');
    expect(getCard?.description).toContain('get_card_details');
  });

  it('get_card_details : échéance nulle → due:null', async () => {
    prismaMock.card.findFirst.mockResolvedValue({
      id: 'c1',
      title: 'Sans échéance',
      description: null,
      dueDate: null,
      column: { name: 'À faire' },
      assignees: [],
      checklistItems: [],
    });
    const out = JSON.parse(
      await execute('get_card_details', { cardId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' }),
    );
    expect(out.due).toBeNull();
  });

  it('get_card_details : carte hors workspace/scope → « Carte introuvable. »', async () => {
    prismaMock.card.findFirst.mockResolvedValue(null);
    const out = await execute('get_card_details', {
      cardId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa',
    });
    expect(out).toBe('Carte introuvable.');
  });

  it('get_card_details : where scope-scopé via AND explicite, jamais de spread à plat à côté de id', async () => {
    scopeMocks.scopedCardWhere.mockReturnValueOnce({ project: { id: { in: ['scope-p1'] } } });
    prismaMock.card.findFirst.mockResolvedValue(null);
    await execute('get_card_details', { cardId: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' });
    const where = prismaMock.card.findFirst.mock.calls[0]?.[0]?.where;
    expect(where?.AND).toEqual([
      { id: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa' },
      { project: { id: { in: ['scope-p1'] } } },
    ]);
    expect(where?.workspaceId).toBe('w1');
    expect(where?.deletedAt).toBeNull();
    expect(scopeMocks.scopedCardWhere).toHaveBeenCalled();
  });

  it('erreur NEXT_REDIRECT (session expirée) → message « session expirée » dédié', async () => {
    prismaMock.project.findMany.mockRejectedValue(
      Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;replace;/login;307;' }),
    );
    const out = await execute('list_projects', {});
    expect(out).toBe('Erreur : session expirée — reconnectez-vous.');
  });

  it('erreur Prisma → message utilisateur, pas de fuite du message brut', async () => {
    prismaMock.project.findMany.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:5432'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = await execute('list_projects', {});
    expect(out).not.toContain('ECONNREFUSED');
    expect(out.toLowerCase()).toContain('erreur');
    // Log serveur redigé : étiquette du tool uniquement, jamais l'erreur brute.
    expect(consoleError).toHaveBeenCalledWith('[assistant] tool db error', {
      tool: 'list_projects',
    });
    consoleError.mockRestore();
  });
});
