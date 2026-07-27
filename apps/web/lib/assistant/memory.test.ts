import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — a plain `const` here
// would be referenced before initialization (see repo convention in
// lib/assistant/tools/read-tools.test.ts).
const prismaMock = vi.hoisted(() => ({
  assistantMemory: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));

import {
  MEMORY_FACT_MAX_CHARS,
  MEMORY_MAX_FACTS,
  forgetFact,
  loadMemories,
  rememberFact,
  slugifyFact,
  updateFact,
} from './memory';

const ctx = {
  userId: 'u1',
  email: 'a@b.c',
  workspaceId: 'w1',
  role: 'user' as const,
  isSuperAdmin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('slugifyFact', () => {
  it('translittère les accents et remplace les espaces par des tirets', () => {
    expect(slugifyFact('Préfère les réunions')).toBe('prefere-les-reunions');
  });

  it('plafonne à 6 mots', () => {
    expect(slugifyFact('un deux trois quatre cinq six sept huit')).toBe(
      'un-deux-trois-quatre-cinq-six',
    );
  });

  it('plafonne à 80 caractères, sans tiret final', () => {
    const longWord = 'a'.repeat(100);
    const result = slugifyFact(longWord);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('-')).toBe(false);
  });

  it('retombe sur "fait" quand il ne reste rien après nettoyage', () => {
    expect(slugifyFact('   ¡¡¡ ??? €€€   ')).toBe('fait');
  });
});

describe('loadMemories', () => {
  it('charge les faits du scope (workspace+user), plus anciens d’abord, plafonné à MEMORY_MAX_FACTS', async () => {
    prismaMock.assistantMemory.findMany.mockResolvedValue([
      { name: 'aime-le-cafe', fact: 'Aime le café' },
    ]);
    const out = await loadMemories(ctx);
    expect(out).toEqual([{ name: 'aime-le-cafe', fact: 'Aime le café' }]);
    const call = prismaMock.assistantMemory.findMany.mock.calls[0]?.[0];
    expect(call.where).toEqual({ workspaceId: 'w1', userId: 'u1' });
    expect(call.orderBy).toEqual({ createdAt: 'asc' });
    expect(call.take).toBe(MEMORY_MAX_FACTS);
  });
});

describe('rememberFact', () => {
  it('crée un fait et renvoie son nom', async () => {
    prismaMock.assistantMemory.count.mockResolvedValue(0);
    prismaMock.assistantMemory.findFirst.mockResolvedValue(null);
    prismaMock.assistantMemory.create.mockResolvedValue({});

    const out = await rememberFact(ctx, 'Préfère les réunions le matin');

    expect(out).toEqual({ ok: true, name: 'prefere-les-reunions-le-matin' });
    const countWhere = prismaMock.assistantMemory.count.mock.calls[0]?.[0]?.where;
    expect(countWhere).toEqual({ workspaceId: 'w1', userId: 'u1' });
    const findFirstWhere = prismaMock.assistantMemory.findFirst.mock.calls[0]?.[0]?.where;
    expect(findFirstWhere).toEqual({
      workspaceId: 'w1',
      userId: 'u1',
      name: 'prefere-les-reunions-le-matin',
    });
    const createData = prismaMock.assistantMemory.create.mock.calls[0]?.[0]?.data;
    expect(createData).toEqual({
      workspaceId: 'w1',
      userId: 'u1',
      name: 'prefere-les-reunions-le-matin',
      fact: 'Préfère les réunions le matin',
    });
  });

  it('ajoute un suffixe incrémental en cas de collision de nom', async () => {
    prismaMock.assistantMemory.count.mockResolvedValue(0);
    prismaMock.assistantMemory.findFirst
      .mockResolvedValueOnce({ id: 'existing-1' }) // base name taken
      .mockResolvedValueOnce({ id: 'existing-2' }) // -2 also taken
      .mockResolvedValueOnce(null); // -3 free
    prismaMock.assistantMemory.create.mockResolvedValue({});

    const out = await rememberFact(ctx, 'Aime le café');

    expect(out).toEqual({ ok: true, name: 'aime-le-cafe-3' });
    expect(prismaMock.assistantMemory.findFirst).toHaveBeenCalledTimes(3);
    expect(prismaMock.assistantMemory.findFirst.mock.calls[0]?.[0]?.where.name).toBe(
      'aime-le-cafe',
    );
    expect(prismaMock.assistantMemory.findFirst.mock.calls[1]?.[0]?.where.name).toBe(
      'aime-le-cafe-2',
    );
    expect(prismaMock.assistantMemory.findFirst.mock.calls[2]?.[0]?.where.name).toBe(
      'aime-le-cafe-3',
    );
    const createData = prismaMock.assistantMemory.create.mock.calls[0]?.[0]?.data;
    expect(createData.name).toBe('aime-le-cafe-3');
  });

  it('course sur la contrainte unique (P2002) → re-cherche un nom libre puis réussit', async () => {
    prismaMock.assistantMemory.count.mockResolvedValue(0);
    prismaMock.assistantMemory.findFirst
      .mockResolvedValueOnce(null) // attempt 1: base name looks free…
      .mockResolvedValueOnce({ id: 'raced' }) // attempt 2: base now taken by the racer
      .mockResolvedValueOnce(null); // attempt 2: -2 free
    prismaMock.assistantMemory.create
      .mockRejectedValueOnce({ code: 'P2002' }) // …but a concurrent create won the race
      .mockResolvedValueOnce({});

    const out = await rememberFact(ctx, 'Aime le café');

    expect(out).toEqual({ ok: true, name: 'aime-le-cafe-2' });
    expect(prismaMock.assistantMemory.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.assistantMemory.create.mock.calls[1]?.[0]?.data.name).toBe('aime-le-cafe-2');
  });

  it('P2002 persistant après 3 tentatives → erreur montrable, pas de throw', async () => {
    prismaMock.assistantMemory.count.mockResolvedValue(0);
    prismaMock.assistantMemory.findFirst.mockResolvedValue(null);
    prismaMock.assistantMemory.create.mockRejectedValue({ code: 'P2002' });

    const out = await rememberFact(ctx, 'Aime le café');

    expect(out).toEqual({ ok: false, message: 'Impossible d’enregistrer le fait — réessayez.' });
    expect(prismaMock.assistantMemory.create).toHaveBeenCalledTimes(3);
  });

  it('erreur Prisma non-P2002 lors du create → propagée (safe-wrappers la gère)', async () => {
    prismaMock.assistantMemory.count.mockResolvedValue(0);
    prismaMock.assistantMemory.findFirst.mockResolvedValue(null);
    prismaMock.assistantMemory.create.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(rememberFact(ctx, 'Aime le café')).rejects.toThrow('ECONNREFUSED');
    expect(prismaMock.assistantMemory.create).toHaveBeenCalledTimes(1);
  });

  it('refuse un fait vide', async () => {
    const out = await rememberFact(ctx, '    ');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain('vide');
    expect(prismaMock.assistantMemory.count).not.toHaveBeenCalled();
    expect(prismaMock.assistantMemory.create).not.toHaveBeenCalled();
  });

  it('refuse un fait trop long (> 500 caractères)', async () => {
    const out = await rememberFact(ctx, 'x'.repeat(MEMORY_FACT_MAX_CHARS + 1));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain('un petit fait par entrée');
    expect(prismaMock.assistantMemory.count).not.toHaveBeenCalled();
    expect(prismaMock.assistantMemory.create).not.toHaveBeenCalled();
  });

  it('refuse quand le plafond de MEMORY_MAX_FACTS est atteint', async () => {
    prismaMock.assistantMemory.count.mockResolvedValue(MEMORY_MAX_FACTS);
    const out = await rememberFact(ctx, 'Un nouveau fait');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain('pleine');
    expect(prismaMock.assistantMemory.create).not.toHaveBeenCalled();
  });
});

describe('updateFact', () => {
  it('met à jour le fait existant', async () => {
    prismaMock.assistantMemory.updateMany.mockResolvedValue({ count: 1 });
    const out = await updateFact(ctx, 'aime-le-cafe', 'Aime le café serré');
    expect(out).toEqual({ ok: true });
    const call = prismaMock.assistantMemory.updateMany.mock.calls[0]?.[0];
    expect(call.where).toEqual({ workspaceId: 'w1', userId: 'u1', name: 'aime-le-cafe' });
    expect(call.data).toEqual({ fact: 'Aime le café serré' });
  });

  it('refuse un fait vide', async () => {
    const out = await updateFact(ctx, 'aime-le-cafe', '   ');
    expect(out.ok).toBe(false);
    expect(prismaMock.assistantMemory.updateMany).not.toHaveBeenCalled();
  });

  it('refuse un fait trop long', async () => {
    const out = await updateFact(ctx, 'aime-le-cafe', 'x'.repeat(MEMORY_FACT_MAX_CHARS + 1));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain('un petit fait par entrée');
    expect(prismaMock.assistantMemory.updateMany).not.toHaveBeenCalled();
  });

  it('nom introuvable → message listant les noms existants (tronqué à 10 via take)', async () => {
    prismaMock.assistantMemory.updateMany.mockResolvedValue({ count: 0 });
    // La troncature est faite au niveau DB (`take: 10`) : le mock renvoie
    // ce que la DB renverrait après application de la limite.
    const names = Array.from({ length: 10 }, (_, i) => ({ name: `nom-${i}` }));
    prismaMock.assistantMemory.findMany.mockResolvedValue(names);

    const out = await updateFact(ctx, 'inconnu', 'Un fait');

    expect(out.ok).toBe(false);
    if (!out.ok) {
      for (let i = 0; i < 10; i++) expect(out.message).toContain(`nom-${i}`);
    }
    const listCall = prismaMock.assistantMemory.findMany.mock.calls[0]?.[0];
    expect(listCall.where).toEqual({ workspaceId: 'w1', userId: 'u1' });
    expect(listCall.take).toBe(10);
  });

  it('nom introuvable et aucun fait existant → "(aucun)"', async () => {
    prismaMock.assistantMemory.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.assistantMemory.findMany.mockResolvedValue([]);
    const out = await updateFact(ctx, 'inconnu', 'Un fait');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain('(aucun)');
  });
});

describe('forgetFact', () => {
  it('supprime le fait existant', async () => {
    prismaMock.assistantMemory.deleteMany.mockResolvedValue({ count: 1 });
    const out = await forgetFact(ctx, 'aime-le-cafe');
    expect(out).toEqual({ ok: true });
    const call = prismaMock.assistantMemory.deleteMany.mock.calls[0]?.[0];
    expect(call.where).toEqual({ workspaceId: 'w1', userId: 'u1', name: 'aime-le-cafe' });
  });

  it('nom introuvable → message listant les noms existants', async () => {
    prismaMock.assistantMemory.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.assistantMemory.findMany.mockResolvedValue([
      { name: 'aime-le-cafe' },
      { name: 'prefere-le-matin' },
    ]);
    const out = await forgetFact(ctx, 'inconnu');
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toContain('aime-le-cafe');
      expect(out.message).toContain('prefere-le-matin');
    }
    const listCall = prismaMock.assistantMemory.findMany.mock.calls[0]?.[0];
    expect(listCall.where).toEqual({ workspaceId: 'w1', userId: 'u1' });
  });
});
