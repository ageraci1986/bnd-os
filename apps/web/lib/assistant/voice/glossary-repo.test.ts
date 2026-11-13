import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  membership: { findMany: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  scopeMock.loadUserScope.mockResolvedValue({ kind: 'workspace' });
  prismaMock.membership.findMany.mockResolvedValue([
    { userId: 'u2', user: { firstName: 'Hélène', lastName: 'Durand' } },
    { userId: 'u1', user: { firstName: 'Angelo', lastName: 'Geraci' } },
  ]);
  prismaMock.client.findMany.mockResolvedValue([{ name: 'Izybizi' }, { name: 'Casa 47' }]);
  prismaMock.project.findMany.mockResolvedValue([{ name: 'Refonte site' }]);
  prismaMock.contact.findMany.mockResolvedValue([{ firstName: 'Marc', lastName: 'Lefèvre' }]);
  prismaMock.workspace.findUnique.mockResolvedValue({ name: 'BND Agency' });
});

describe('loadProperNouns', () => {
  it("rend les noms dans l'ordre de priorité, l'utilisateur courant en tête", async () => {
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

  it('rend les noms BRUTS (chiffres compris) : le nettoyage appartient à toKeyterms', async () => {
    expect(await loadProperNouns(ctx)).toContain('Casa 47');
  });

  it('tolère un prénom ou un nom absent, et ignore un membre sans aucun des deux', async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      { userId: 'u1', user: { firstName: 'Angelo', lastName: null } },
      { userId: 'u2', user: { firstName: null, lastName: null } },
      { userId: 'u3', user: { firstName: null, lastName: 'Durand' } },
    ]);
    const out = await loadProperNouns(ctx);
    expect(out.slice(0, 2)).toEqual(['Angelo', 'Durand']);
    expect(out).not.toContain('');
  });

  it('filtre TOUTES les requêtes par workspaceId', async () => {
    await loadProperNouns(ctx);
    expect(prismaMock.membership.findMany.mock.calls[0]![0].where).toEqual({ workspaceId: 'w1' });
    expect(prismaMock.client.findMany.mock.calls[0]![0].where.AND[0]).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      archivedAt: null,
    });
    expect(prismaMock.project.findMany.mock.calls[0]![0].where.AND[0]).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      archivedAt: null,
    });
    expect(prismaMock.contact.findMany.mock.calls[0]![0].where).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
    });
    expect(prismaMock.workspace.findUnique.mock.calls[0]![0].where).toEqual({ id: 'w1' });
  });

  it("applique le périmètre d'un membre restreint aux clients, projets ET contacts", async () => {
    scopeMock.loadUserScope.mockResolvedValue({
      kind: 'restricted',
      clientIds: ['c1'],
      projectIds: [],
    });
    await loadProperNouns(ctx);
    expect(scopeMock.loadUserScope).toHaveBeenCalledWith(ctx);
    expect(prismaMock.client.findMany.mock.calls[0]![0].where.AND[1]).toEqual({
      id: { in: ['c1'] },
    });
    expect(prismaMock.project.findMany.mock.calls[0]![0].where.AND[1]).toEqual({
      clientId: { in: ['c1'] },
    });
    expect(prismaMock.contact.findMany.mock.calls[0]![0].where.client.AND[1]).toEqual({
      id: { in: ['c1'] },
    });
  });

  it('borne chaque lecture et ne sélectionne que les noms', async () => {
    await loadProperNouns(ctx);
    expect(prismaMock.membership.findMany.mock.calls[0]![0].take).toBe(11);
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

  it('ne lève jamais : une panne Prisma rend une liste vide', async () => {
    prismaMock.client.findMany.mockRejectedValue(new Error('db down'));
    await expect(loadProperNouns(ctx)).resolves.toEqual([]);
  });

  it('ne lève jamais : une panne du chargement de périmètre rend une liste vide', async () => {
    scopeMock.loadUserScope.mockRejectedValue(new Error('scope down'));
    await expect(loadProperNouns(ctx)).resolves.toEqual([]);
    expect(prismaMock.client.findMany).not.toHaveBeenCalled();
  });

  it('tolère un workspace introuvable', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(null);
    expect(await loadProperNouns(ctx)).not.toContain('BND Agency');
  });
});
