import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolSpec } from '@nexushub/agent';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock functions themselves must be created via `vi.hoisted` — repo
// convention (see mail-tools.test.ts, kanban-tools.test.ts).
const memoryMocks = vi.hoisted(() => ({
  rememberFact: vi.fn(),
  updateFact: vi.fn(),
  forgetFact: vi.fn(),
}));
vi.mock('@/lib/assistant/memory', () => ({
  ...memoryMocks,
  MEMORY_FACT_MAX_CHARS: 500,
}));

import { buildMemoryTools } from './memory-tools';

const ctx = {
  userId: 'u1',
  email: 'a@b.c',
  workspaceId: 'w1',
  role: 'user' as const,
  isSuperAdmin: false,
};

function tools(): ToolSpec[] {
  return buildMemoryTools(ctx);
}

function getTool(name: string): ToolSpec {
  const tool = tools().find((t) => t.name === name);
  if (tool === undefined) throw new Error(`tool absent: ${name}`);
  return tool;
}

async function run(name: string, input: unknown): Promise<string> {
  return getTool(name).handler(input as never);
}

/** Clés Zod requises (non-optionnelles) d'un objet — pour le spot-check de parité avec jsonSchema. */
function requiredKeys(schema: z.ZodTypeAny): string[] {
  if (!(schema instanceof z.ZodObject)) throw new Error('expected a ZodObject');
  return Object.entries(schema.shape)
    .filter(([, field]) => !(field as z.ZodTypeAny).isOptional())
    .map(([key]) => key);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildMemoryTools', () => {
  it('expose les 3 tools mémoire, aucun gated, aucun adminOnly', () => {
    const list = tools();
    expect(list.map((t) => t.name).sort()).toEqual(['forget_fact', 'remember_fact', 'update_fact']);
    expect(list.every((t) => !t.gated)).toBe(true);
    expect(list.every((t) => !t.adminOnly)).toBe(true);
  });

  it('jsonSchema (required + properties) correspond au schéma Zod, pour chaque tool', () => {
    for (const t of tools()) {
      const json = t.jsonSchema as { required?: string[]; properties?: Record<string, unknown> };
      const jsonRequired = [...(json.required ?? [])].sort();
      const zodRequired = requiredKeys(t.inputSchema as z.ZodTypeAny).sort();
      expect(jsonRequired, `required mismatch on ${t.name}`).toEqual(zodRequired);

      const zodShape = (t.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
      const jsonKeys = Object.keys(json.properties ?? {}).sort();
      const zodKeys = Object.keys(zodShape).sort();
      expect(jsonKeys, `properties mismatch on ${t.name}`).toEqual(zodKeys);
    }
  });

  describe('remember_fact', () => {
    it('passe ctx + fact au core, succès → {remembered:true, name}', async () => {
      memoryMocks.rememberFact.mockResolvedValue({ ok: true, name: 'aime-le-cafe' });
      const out = await run('remember_fact', { fact: 'Aime le café' });
      expect(memoryMocks.rememberFact).toHaveBeenCalledWith(ctx, 'Aime le café');
      expect(JSON.parse(out)).toEqual({ remembered: true, name: 'aime-le-cafe' });
    });

    it('échec du core → message montrable préfixé "Échec :"', async () => {
      memoryMocks.rememberFact.mockResolvedValue({
        ok: false,
        message: 'Mémoire pleine — consolidez ou supprimez des faits avant d’en ajouter.',
      });
      const out = await run('remember_fact', { fact: 'Un fait de trop' });
      expect(out).toBe(
        'Échec : Mémoire pleine — consolidez ou supprimez des faits avant d’en ajouter.',
      );
    });

    it('rejette un fait vide (trim) au niveau du schéma', () => {
      const schema = getTool('remember_fact').inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({ fact: '   ' }).success).toBe(false);
    });

    it('rejette un fait de plus de 500 caractères au niveau du schéma', () => {
      const schema = getTool('remember_fact').inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({ fact: 'x'.repeat(501) }).success).toBe(false);
      expect(schema.safeParse({ fact: 'x'.repeat(500) }).success).toBe(true);
    });
  });

  describe('update_fact', () => {
    it('passe ctx + name + fact au core, succès → {updated:true}', async () => {
      memoryMocks.updateFact.mockResolvedValue({ ok: true });
      const out = await run('update_fact', { name: 'aime-le-cafe', fact: 'Aime le café serré' });
      expect(memoryMocks.updateFact).toHaveBeenCalledWith(
        ctx,
        'aime-le-cafe',
        'Aime le café serré',
      );
      expect(JSON.parse(out)).toEqual({ updated: true });
    });

    it('échec (nom introuvable) → message montrable relayé', async () => {
      memoryMocks.updateFact.mockResolvedValue({
        ok: false,
        message: 'Aucun fait nommé « inconnu ». Faits existants : (aucun).',
      });
      const out = await run('update_fact', { name: 'inconnu', fact: 'Un fait' });
      expect(out).toBe('Échec : Aucun fait nommé « inconnu ». Faits existants : (aucun).');
    });

    it('rejette un name vide ou de plus de 80 caractères au niveau du schéma', () => {
      const schema = getTool('update_fact').inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({ name: '', fact: 'x' }).success).toBe(false);
      expect(schema.safeParse({ name: 'x'.repeat(81), fact: 'x' }).success).toBe(false);
      expect(schema.safeParse({ name: 'x'.repeat(80), fact: 'x' }).success).toBe(true);
    });
  });

  describe('forget_fact', () => {
    it('passe ctx + name au core, succès → {forgotten:true}', async () => {
      memoryMocks.forgetFact.mockResolvedValue({ ok: true });
      const out = await run('forget_fact', { name: 'aime-le-cafe' });
      expect(memoryMocks.forgetFact).toHaveBeenCalledWith(ctx, 'aime-le-cafe');
      expect(JSON.parse(out)).toEqual({ forgotten: true });
    });

    it('échec (nom introuvable) → message montrable relayé', async () => {
      memoryMocks.forgetFact.mockResolvedValue({
        ok: false,
        message: 'Aucun fait nommé « inconnu ». Faits existants : aime-le-cafe.',
      });
      const out = await run('forget_fact', { name: 'inconnu' });
      expect(out).toBe('Échec : Aucun fait nommé « inconnu ». Faits existants : aime-le-cafe.');
    });
  });

  it('erreur brute (throw) dans le core → message générique montrable, pas de détail interne', async () => {
    memoryMocks.rememberFact.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = await run('remember_fact', { fact: 'Un fait' });
    expect(out).not.toContain('ECONNREFUSED');
    expect(out.toLowerCase()).toContain('erreur');
    consoleError.mockRestore();
  });
});
