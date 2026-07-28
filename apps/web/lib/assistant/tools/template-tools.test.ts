import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolSpec } from '@nexushub/agent';

// `vi.mock` factories sont hoisted au-dessus des imports — repo convention
// (voir client-tools.test.ts, kanban-tools.test.ts).
const actionsMocks = vi.hoisted(() => ({
  createKanbanTemplate: vi.fn(),
  updateKanbanTemplate: vi.fn(),
  deleteKanbanTemplate: vi.fn(),
}));
vi.mock('@/features/templates/kanban/actions', () => actionsMocks);

// `kanbanTemplate.findFirst` : lecture-après-écriture de `update_template` et
// lookup véridique du `describeForConfirm` gated de `delete_template`.
const prismaMocks = vi.hoisted(() => ({
  kanbanTemplate: { findFirst: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMocks }));

import { buildTemplateTools } from './template-tools';

const ctx = {
  userId: 'u1',
  email: 'a@b.c',
  workspaceId: 'w1',
  role: 'user' as const,
  isSuperAdmin: false,
};

const TEMPLATE_ID = '4c9d3f0a-2222-4444-8888-cccccccccccc';

function tools(): ToolSpec[] {
  return buildTemplateTools(ctx);
}

function getTool(name: string): ToolSpec {
  const tool = tools().find((t) => t.name === name);
  if (tool === undefined) throw new Error(`tool absent: ${name}`);
  return tool;
}

async function run(name: string, input: unknown): Promise<string> {
  return getTool(name).handler(input as never);
}

/** Clés Zod requises (non-optionnelles) d'un objet — spot-check parité jsonSchema. */
function requiredKeys(schema: z.ZodTypeAny): string[] {
  if (!(schema instanceof z.ZodObject)) throw new Error('expected a ZodObject');
  return Object.entries(schema.shape as Record<string, z.ZodTypeAny>)
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildTemplateTools', () => {
  it('expose les 3 tools, delete_template seul gated, aucun adminOnly', () => {
    const list = tools();
    expect(list.map((t) => t.name).sort()).toEqual([
      'create_template',
      'delete_template',
      'update_template',
    ]);
    expect(list.every((t) => t.adminOnly !== true)).toBe(true);
    const gatedNames = new Set(['delete_template']);
    for (const t of list) {
      expect(t.gated).toBe(gatedNames.has(t.name));
    }
  });

  it('jsonSchema (required + properties) correspond au schéma Zod, pour chaque tool', () => {
    for (const t of tools()) {
      const json = t.jsonSchema as { required?: string[]; properties?: Record<string, unknown> };
      const jsonRequired = [...(json.required ?? [])].sort();
      const zodRequired = requiredKeys(t.inputSchema as z.ZodTypeAny).sort();
      expect(jsonRequired, `required mismatch on ${t.name}`).toEqual(zodRequired);

      const zodSchema = t.inputSchema as z.ZodTypeAny;
      if (!(zodSchema instanceof z.ZodObject)) throw new Error(`expected ZodObject on ${t.name}`);
      const jsonKeys = Object.keys(json.properties ?? {}).sort();
      const zodKeys = Object.keys(zodSchema.shape as Record<string, unknown>).sort();
      expect(jsonKeys, `properties mismatch on ${t.name}`).toEqual(zodKeys);
    }
  });

  // ---------- create_template -------------------------------------------------

  it('create_template : délègue à createKanbanTemplate avec stepChecklist par défaut [], JSON sur succès', async () => {
    actionsMocks.createKanbanTemplate.mockResolvedValue({ ok: true, id: 't-1' });
    const out = await run('create_template', {
      name: 'Onboarding',
      columns: [{ name: 'À faire' }, { name: 'En cours', stepChecklist: ['Briefer le client'] }],
    });
    expect(actionsMocks.createKanbanTemplate).toHaveBeenCalledWith({
      name: 'Onboarding',
      columns: [
        { name: 'À faire', stepChecklist: [] },
        { name: 'En cours', stepChecklist: ['Briefer le client'] },
      ],
    });
    expect(JSON.parse(out)).toEqual({ created: true, templateId: 't-1' });
  });

  it('create_template : échec core (nom dupliqué) → message montrable', async () => {
    actionsMocks.createKanbanTemplate.mockResolvedValue({
      ok: false,
      message: 'Un template porte déjà ce nom.',
    });
    const out = await run('create_template', {
      name: 'Onboarding',
      columns: [{ name: 'À faire' }],
    });
    expect(out).toBe('Échec : Un template porte déjà ce nom.');
  });

  it('create_template : le schéma exige au moins 1 colonne (restriction du tool, pas du core)', () => {
    const schema = getTool('create_template').inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({ name: 'X', columns: [] }).success).toBe(false);
    expect(schema.safeParse({ name: 'X', columns: [{ name: 'A' }] }).success).toBe(true);
  });

  it('create_template : le schéma plafonne à 20 colonnes (KANBAN_COLUMNS_MAX)', () => {
    const schema = getTool('create_template').inputSchema as z.ZodTypeAny;
    const cols20 = Array.from({ length: 20 }, (_, i) => ({ name: `C${i}` }));
    const cols21 = Array.from({ length: 21 }, (_, i) => ({ name: `C${i}` }));
    expect(schema.safeParse({ name: 'X', columns: cols20 }).success).toBe(true);
    expect(schema.safeParse({ name: 'X', columns: cols21 }).success).toBe(false);
  });

  it('create_template : le schéma borne le nom du template à 120 caractères (garde-fou pré-trim du core)', () => {
    const schema = getTool('create_template').inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({ name: 'a'.repeat(120), columns: [{ name: 'A' }] }).success).toBe(
      true,
    );
    expect(schema.safeParse({ name: 'a'.repeat(121), columns: [{ name: 'A' }] }).success).toBe(
      false,
    );
  });

  it('create_template : le schéma borne le nom de colonne à 60 caractères (KANBAN_COLUMN_NAME_MAX)', () => {
    const schema = getTool('create_template').inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({ name: 'X', columns: [{ name: 'a'.repeat(60) }] }).success).toBe(true);
    expect(schema.safeParse({ name: 'X', columns: [{ name: 'a'.repeat(61) }] }).success).toBe(
      false,
    );
  });

  it('create_template : le schéma plafonne stepChecklist à 20 items de 200 caractères max', () => {
    const schema = getTool('create_template').inputSchema as z.ZodTypeAny;
    const ok = {
      name: 'X',
      columns: [{ name: 'A', stepChecklist: Array(20).fill('a'.repeat(200)) }],
    };
    const tooMany = {
      name: 'X',
      columns: [{ name: 'A', stepChecklist: Array(21).fill('x') }],
    };
    const tooLong = { name: 'X', columns: [{ name: 'A', stepChecklist: ['a'.repeat(201)] }] };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse(tooMany).success).toBe(false);
    expect(schema.safeParse(tooLong).success).toBe(false);
  });

  // ---------- update_template ----------------------------------------------

  it('update_template : délègue { id, name, columns } puis relit le template (lecture-après-écriture)', async () => {
    actionsMocks.updateKanbanTemplate.mockResolvedValue({ ok: true, id: TEMPLATE_ID });
    prismaMocks.kanbanTemplate.findFirst.mockResolvedValueOnce({
      name: 'Onboarding v2',
      columns: [{ name: 'À faire' }, { name: 'Fait' }],
    });

    const out = await run('update_template', {
      templateId: TEMPLATE_ID,
      name: 'Onboarding v2',
      columns: [{ name: 'À faire' }, { name: 'Fait' }],
    });

    expect(actionsMocks.updateKanbanTemplate).toHaveBeenCalledWith({
      id: TEMPLATE_ID,
      name: 'Onboarding v2',
      columns: [
        { name: 'À faire', stepChecklist: [] },
        { name: 'Fait', stepChecklist: [] },
      ],
    });
    expect(prismaMocks.kanbanTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: TEMPLATE_ID, workspaceId: ctx.workspaceId },
      select: { name: true, columns: { orderBy: { position: 'asc' }, select: { name: true } } },
    });
    expect(JSON.parse(out)).toEqual({
      updated: true,
      name: 'Onboarding v2',
      columns: [{ name: 'À faire' }, { name: 'Fait' }],
    });
  });

  it('update_template : échec core → message montrable, pas de lecture-après-écriture', async () => {
    actionsMocks.updateKanbanTemplate.mockResolvedValue({
      ok: false,
      message: 'Un template porte déjà ce nom.',
    });
    const out = await run('update_template', {
      templateId: TEMPLATE_ID,
      name: 'X',
      columns: [{ name: 'A' }],
    });
    expect(out).toBe('Échec : Un template porte déjà ce nom.');
    expect(prismaMocks.kanbanTemplate.findFirst).not.toHaveBeenCalled();
  });

  it('update_template : template introuvable après écriture (course improbable) → échec explicite', async () => {
    actionsMocks.updateKanbanTemplate.mockResolvedValue({ ok: true, id: TEMPLATE_ID });
    prismaMocks.kanbanTemplate.findFirst.mockResolvedValueOnce(null);
    const out = await run('update_template', {
      templateId: TEMPLATE_ID,
      name: 'X',
      columns: [{ name: 'A' }],
    });
    expect(out).toBe('Échec : Template introuvable après la mise à jour.');
  });

  // ---------- delete_template -----------------------------------------------

  it('delete_template : gated:true, wrappe deleteKanbanTemplate({ id }), succès et échec', async () => {
    const tool = getTool('delete_template');
    expect(tool.gated).toBe(true);

    actionsMocks.deleteKanbanTemplate.mockResolvedValue({ ok: true });
    const ok = await run('delete_template', { templateId: TEMPLATE_ID });
    expect(actionsMocks.deleteKanbanTemplate).toHaveBeenCalledWith({ id: TEMPLATE_ID });
    expect(ok).toBe('Template supprimé.');

    actionsMocks.deleteKanbanTemplate.mockResolvedValue({
      ok: false,
      message: 'Les templates système ne peuvent pas être supprimés.',
    });
    const fail = await run('delete_template', { templateId: TEMPLATE_ID });
    expect(fail).toBe('Échec : Les templates système ne peuvent pas être supprimés.');
  });

  it('delete_template : describeForConfirm re-valide l’input BRUT — invalide → libellé prudent SANS appel DB', async () => {
    const describe = getTool('delete_template').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;

    const empty = await describe({});
    expect(empty).toBe('Supprimer un template introuvable dans ce workspace ?');
    expect(prismaMocks.kanbanTemplate.findFirst).not.toHaveBeenCalled();

    const structured = await describe({ templateId: { not: null } });
    expect(structured).toBe('Supprimer un template introuvable dans ce workspace ?');
    expect(prismaMocks.kanbanTemplate.findFirst).not.toHaveBeenCalled();
  });

  it('delete_template : describeForConfirm — template introuvable en DB (ou hors workspace) → libellé prudent', async () => {
    const describe = getTool('delete_template').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.kanbanTemplate.findFirst.mockResolvedValueOnce(null);
    const out = await describe({ templateId: TEMPLATE_ID });
    expect(prismaMocks.kanbanTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: TEMPLATE_ID, workspaceId: ctx.workspaceId },
      select: { name: true, isBuiltin: true },
    });
    expect(out).toBe('Supprimer un template introuvable dans ce workspace ?');
  });

  it('delete_template : describeForConfirm — template système (isBuiltin) → phrase DÉCLARATIVE de refus', async () => {
    const describe = getTool('delete_template').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.kanbanTemplate.findFirst.mockResolvedValueOnce({
      name: 'Standard',
      isBuiltin: true,
    });
    const out = await describe({ templateId: TEMPLATE_ID });
    expect(out).toBe(
      'Le template « Standard » est un template système — la suppression sera refusée.',
    );
    expect(out).not.toContain('?');
  });

  it('delete_template : describeForConfirm — template normal → question de confirmation avec rappel copy-on-create', async () => {
    const describe = getTool('delete_template').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.kanbanTemplate.findFirst.mockResolvedValueOnce({
      name: 'Onboarding',
      isBuiltin: false,
    });
    const out = await describe({ templateId: TEMPLATE_ID });
    expect(out).toBe(
      'Supprimer le template « Onboarding » ? Les projets existants ne seront pas affectés (colonnes copiées à leur création).',
    );
  });
});
