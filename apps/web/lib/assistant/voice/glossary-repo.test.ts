import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  membership: { findUnique: vi.fn(), findMany: vi.fn() },
  client: { findMany: vi.fn() },
  project: { findMany: vi.fn() },
  contact: { findMany: vi.fn() },
  workspace: { findUnique: vi.fn() },
}));
const scopeMock = vi.hoisted(() => ({ loadUserScope: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/scope', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadUserScope: scopeMock.loadUserScope,
}));

import { loadProperNouns } from './glossary-repo';

const ctx = { userId: 'u1', workspaceId: 'w1', role: 'user' as const, isSuperAdmin: false };

const ACTIVE_IN_WORKSPACE = { workspaceId: 'w1', deletedAt: null, archivedAt: null };

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  scopeMock.loadUserScope.mockResolvedValue({ kind: 'workspace' });
  prismaMock.membership.findUnique.mockResolvedValue({
    user: { firstName: 'Angelo', lastName: 'Geraci' },
  });
  prismaMock.membership.findMany.mockResolvedValue([
    { user: { firstName: 'Hélène', lastName: 'Durand' } },
  ]);
  prismaMock.client.findMany.mockResolvedValue([{ name: 'Izybizi' }, { name: 'Casa 47' }]);
  prismaMock.project.findMany.mockResolvedValue([{ name: 'Refonte site' }]);
  prismaMock.contact.findMany.mockResolvedValue([{ firstName: 'Marc', lastName: 'Lefèvre' }]);
  prismaMock.workspace.findUnique.mockResolvedValue({ name: 'BND Agency' });
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('loadProperNouns', () => {
  it("rend les noms BRUTS dans l'ordre de priorité, l'utilisateur courant en tête", async () => {
    // « Casa 47 » garde son chiffre : le nettoyage appartient à toKeyterms.
    await expect(loadProperNouns(ctx)).resolves.toEqual([
      'Angelo Geraci',
      'Hélène Durand',
      'Izybizi',
      'Casa 47',
      'Refonte site',
      'Marc Lefèvre',
      'BND Agency',
    ]);
  });

  it("lit l'utilisateur courant À PART, pour qu'un quota ne puisse pas l'exclure", async () => {
    await loadProperNouns(ctx);
    expect(prismaMock.membership.findUnique.mock.calls[0]![0]).toEqual({
      where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    expect(prismaMock.membership.findMany.mock.calls[0]![0]).toMatchObject({
      where: { workspaceId: 'w1', userId: { not: 'u1' } },
      take: 10,
    });
  });

  it("tolère l'absence de ligne membership pour l'utilisateur courant", async () => {
    prismaMock.membership.findUnique.mockResolvedValue(null);
    expect((await loadProperNouns(ctx))[0]).toBe('Hélène Durand');
  });

  it('tolère un prénom ou un nom absent, et ignore un membre sans aucun des deux', async () => {
    prismaMock.membership.findUnique.mockResolvedValue({
      user: { firstName: 'Angelo', lastName: null },
    });
    prismaMock.membership.findMany.mockResolvedValue([
      { user: { firstName: null, lastName: null } },
      { user: { firstName: '  ', lastName: 'Durand' } },
    ]);
    const out = await loadProperNouns(ctx);
    expect(out.slice(0, 3)).toEqual(['Angelo', 'Durand', 'Izybizi']);
    expect(out).not.toContain('');
  });

  it('filtre TOUTES les requêtes par workspaceId et écarte supprimés et archivés', async () => {
    await loadProperNouns(ctx);
    expect(prismaMock.client.findMany.mock.calls[0]![0].where).toEqual({
      AND: [ACTIVE_IN_WORKSPACE, {}],
    });
    expect(prismaMock.project.findMany.mock.calls[0]![0].where).toEqual({
      AND: [ACTIVE_IN_WORKSPACE, {}],
    });
    // Contacts : leur client doit être dans le workspace, actif ET visible.
    expect(prismaMock.contact.findMany.mock.calls[0]![0].where).toEqual({
      workspaceId: 'w1',
      deletedAt: null,
      client: { AND: [ACTIVE_IN_WORKSPACE, {}] },
    });
    expect(prismaMock.workspace.findUnique.mock.calls[0]![0].where).toEqual({ id: 'w1' });
  });

  it("applique le périmètre « clients » d'un membre restreint aux clients, projets ET contacts", async () => {
    scopeMock.loadUserScope.mockResolvedValue({
      kind: 'restricted',
      clientIds: ['c1'],
      projectIds: [],
    });
    await loadProperNouns(ctx);
    expect(scopeMock.loadUserScope).toHaveBeenCalledWith(ctx);
    expect(prismaMock.client.findMany.mock.calls[0]![0].where).toEqual({
      AND: [ACTIVE_IN_WORKSPACE, { id: { in: ['c1'] } }],
    });
    expect(prismaMock.project.findMany.mock.calls[0]![0].where).toEqual({
      AND: [ACTIVE_IN_WORKSPACE, { clientId: { in: ['c1'] } }],
    });
    expect(prismaMock.contact.findMany.mock.calls[0]![0].where.client).toEqual({
      AND: [ACTIVE_IN_WORKSPACE, { id: { in: ['c1'] } }],
    });
  });

  it("applique le périmètre « projets » d'un membre restreint aux contacts", async () => {
    scopeMock.loadUserScope.mockResolvedValue({
      kind: 'restricted',
      clientIds: [],
      projectIds: ['p1'],
    });
    await loadProperNouns(ctx);
    expect(prismaMock.project.findMany.mock.calls[0]![0].where).toEqual({
      AND: [ACTIVE_IN_WORKSPACE, { id: { in: ['p1'] } }],
    });
    expect(prismaMock.contact.findMany.mock.calls[0]![0].where.client).toEqual({
      AND: [ACTIVE_IN_WORKSPACE, { projects: { some: { id: { in: ['p1'] } } } }],
    });
  });

  it('borne chaque lecture et ne sélectionne que les noms', async () => {
    await loadProperNouns(ctx);
    expect(prismaMock.client.findMany.mock.calls[0]![0]).toMatchObject({
      take: 12,
      select: { name: true },
    });
    expect(prismaMock.project.findMany.mock.calls[0]![0]).toMatchObject({
      take: 8,
      select: { name: true },
    });
    expect(prismaMock.contact.findMany.mock.calls[0]![0]).toMatchObject({
      take: 8,
      select: { firstName: true, lastName: true },
    });
  });

  it('ne lève jamais : une panne Prisma rend une liste vide et un signal sans PII', async () => {
    prismaMock.client.findMany.mockRejectedValue(new Error('db down near "Izybizi"'));
    await expect(loadProperNouns(ctx)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // Le message d'erreur (qui peut citer des valeurs) n'est jamais loggé.
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain('Izybizi');
    expect(errorSpy.mock.calls[0]![1]).toEqual({ error: 'Error' });
  });

  it('ne lève jamais : une panne du chargement de périmètre rend une liste vide', async () => {
    scopeMock.loadUserScope.mockRejectedValue(new Error('scope down'));
    await expect(loadProperNouns(ctx)).resolves.toEqual([]);
    expect(prismaMock.client.findMany).not.toHaveBeenCalled();
  });

  it('tolère un workspace introuvable sans perdre le reste du glossaire', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(null);
    await expect(loadProperNouns(ctx)).resolves.toEqual([
      'Angelo Geraci',
      'Hélène Durand',
      'Izybizi',
      'Casa 47',
      'Refonte site',
      'Marc Lefèvre',
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
