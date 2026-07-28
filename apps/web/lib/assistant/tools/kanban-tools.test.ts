import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolSpec } from '@nexushub/agent';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock functions themselves must be created via `vi.hoisted` — repo
// convention (see read-tools.test.ts, features/communications/actions/*.test.ts).
const cardCoreMocks = vi.hoisted(() => ({
  createCardCore: vi.fn(),
  deleteCardCore: vi.fn(),
}));
vi.mock('@/features/projects/lib/card-core', () => cardCoreMocks);

const projectCoreMocks = vi.hoisted(() => ({
  createProjectCore: vi.fn(),
  updateProjectCore: vi.fn(),
  deleteProjectCore: vi.fn(),
}));
vi.mock('@/features/projects/lib/project-core', () => projectCoreMocks);

const columnCoreMocks = vi.hoisted(() => ({
  addColumnCore: vi.fn(),
  renameColumnCore: vi.fn(),
  reorderColumnsCore: vi.fn(),
  deleteColumnCore: vi.fn(),
}));
vi.mock('@/features/projects/lib/column-core', () => columnCoreMocks);

const moveCardMocks = vi.hoisted(() => ({ moveCard: vi.fn() }));
vi.mock('@/features/projects/actions/move-card', () => moveCardMocks);

const updateCardMocks = vi.hoisted(() => ({ updateCard: vi.fn() }));
vi.mock('@/features/projects/actions/update-card', () => updateCardMocks);

const dueDateMocks = vi.hoisted(() => ({ updateCardDueDate: vi.fn() }));
vi.mock('@/features/projects/actions/update-card-due-date', () => dueDateMocks);

const assigneeMocks = vi.hoisted(() => ({
  addCardAssignee: vi.fn(),
  removeCardAssignee: vi.fn(),
}));
vi.mock('@/features/projects/actions/card-assignees', () => assigneeMocks);

// Lecture-après-écriture (spec V2 §3.1) : `move_card`/`update_card` relisent
// l'état en DB après mutation — voir repo convention dans card-core.test.ts.
// `project.findFirst` / `column.findFirst` / `card.count` : lookups véridiques
// des `describeForConfirm` gated (delete_project, delete_column) — anti-spoofing,
// voir types.ts.
const prismaMocks = vi.hoisted(() => ({
  card: { findFirst: vi.fn(), count: vi.fn() },
  project: { findFirst: vi.fn() },
  column: { findFirst: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMocks }));

// Scope : les describes gated appliquent le MÊME filtrage que les tools de
// lecture (read-tools) — un restricted ne doit jamais voir le nom/compte
// d'un objet hors de son scope via le dialog de confirmation.
const scopeMocks = vi.hoisted(() => ({
  loadUserScope: vi.fn<() => Promise<unknown>>(async () => ({ kind: 'workspace' as const })),
  scopedProjectWhere: vi.fn((): Record<string, unknown> => ({})),
}));
vi.mock('@/lib/auth/scope', () => scopeMocks);

// `CreateProjectSchema` is NOT mocked: the invalid-dates test relies on its
// real validation message.
import { buildKanbanTools } from './kanban-tools';

const ctx = {
  userId: 'u1',
  email: 'a@b.c',
  workspaceId: 'w1',
  role: 'user' as const,
  isSuperAdmin: false,
};

const CARD_ID = '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa';
const PROJECT_ID = '4c9d3f0a-2222-4444-8888-bbbbbbbbbbbb';
const COLUMN_ID = '4c9d3f0a-2222-4444-8888-cccccccccccc';
const USER_ID = '4c9d3f0a-2222-4444-8888-dddddddddddd';
const CLIENT_ID = '4c9d3f0a-2222-4444-8888-eeeeeeeeeeee';

function tools(): ToolSpec[] {
  return buildKanbanTools(ctx);
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
  return Object.entries(schema.shape as Record<string, z.ZodTypeAny>)
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key);
}

beforeEach(() => {
  vi.clearAllMocks();
  scopeMocks.loadUserScope.mockResolvedValue({ kind: 'workspace' as const });
  scopeMocks.scopedProjectWhere.mockReturnValue({});
});

describe('buildKanbanTools', () => {
  it('expose les 14 tools mutants, delete_card/delete_project/delete_column gated, aucun adminOnly', () => {
    const list = tools();
    expect(list.map((t) => t.name).sort()).toEqual([
      'add_card_assignee',
      'add_column',
      'create_card',
      'create_project',
      'delete_card',
      'delete_column',
      'delete_project',
      'move_card',
      'remove_card_assignee',
      'rename_column',
      'reorder_columns',
      'set_card_due_date',
      'update_card',
      'update_project',
    ]);
    expect(list.every((t) => !t.adminOnly)).toBe(true);
    const gatedNames = new Set(['delete_card', 'delete_project', 'delete_column']);
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

  it('safeMutation : erreur brute (ex. Prisma) → message générique, aucune fuite du message', async () => {
    cardCoreMocks.createCardCore.mockRejectedValue(
      Object.assign(new Error("Can't reach database server at db.xxx.supabase.co"), {}),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = await run('create_card', {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'X',
    });
    expect(out).toBe("Erreur interne pendant l'action — réessayez dans un instant.");
    expect(out).not.toContain('supabase.co');
    // Log serveur redigé : étiquette du tool uniquement, jamais l'erreur brute.
    expect(consoleError).toHaveBeenCalledWith('[assistant] tool mutation error', {
      tool: 'create_card',
    });
    consoleError.mockRestore();
  });

  it('safeMutation : digest NEXT_REDIRECT (requireUser sans session) → message session expirée', async () => {
    moveCardMocks.moveCard.mockRejectedValue(
      Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;push;/login' }),
    );
    const out = await run('move_card', {
      cardId: CARD_ID,
      targetColumnId: COLUMN_ID,
      targetIndex: 0,
    });
    expect(out).toBe('Échec : session expirée — reconnectez-vous.');
  });

  it('safeMutation : NotFoundError (code NOT_FOUND) → message périmètre, sans fuite du resource name', async () => {
    dueDateMocks.updateCardDueDate.mockRejectedValue(
      Object.assign(new Error('Card not found'), { code: 'NOT_FOUND' }),
    );
    const out = await run('set_card_due_date', { cardId: CARD_ID, dueDate: '2026-08-01' });
    expect(out).toBe('Échec : élément introuvable ou hors de votre périmètre.');
  });

  it('set_card_due_date : le schéma refuse un format non YYYY-MM-DD et accepte date valide ou null', () => {
    const schema = getTool('set_card_due_date').inputSchema as z.ZodTypeAny;
    const bad = schema.safeParse({ cardId: CARD_ID, dueDate: 'demain' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe('Format attendu : YYYY-MM-DD');
    }
    expect(schema.safeParse({ cardId: CARD_ID, dueDate: '2026-08-01' }).success).toBe(true);
    expect(schema.safeParse({ cardId: CARD_ID, dueDate: null }).success).toBe(true);
  });

  it('set_card_due_date : le schéma refuse une date calendaire inexistante (2026-02-30)', () => {
    const schema = getTool('set_card_due_date').inputSchema as z.ZodTypeAny;
    const bad = schema.safeParse({ cardId: CARD_ID, dueDate: '2026-02-30' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe('Date invalide.');
    }
  });

  it('create_project : le schéma du tool refuse startDate/endDate hors format YYYY-MM-DD', () => {
    const schema = getTool('create_project').inputSchema as z.ZodTypeAny;
    const base = { name: 'P', clientId: CLIENT_ID, templateId: 'creative' };
    expect(schema.safeParse({ ...base, startDate: 'demain' }).success).toBe(false);
    expect(schema.safeParse({ ...base, endDate: '01/08/2026' }).success).toBe(false);
    expect(
      schema.safeParse({ ...base, startDate: '2026-08-01', endDate: '2026-09-01' }).success,
    ).toBe(true);
  });

  it('create_project : le schéma du tool refuse une date calendaire inexistante (2026-02-30) sur startDate et endDate', () => {
    const schema = getTool('create_project').inputSchema as z.ZodTypeAny;
    const base = { name: 'P', clientId: CLIENT_ID, templateId: 'creative' };
    const badStart = schema.safeParse({ ...base, startDate: '2026-02-30' });
    expect(badStart.success).toBe(false);
    if (!badStart.success) {
      expect(badStart.error.issues[0]?.message).toBe('Date invalide.');
    }
    const badEnd = schema.safeParse({ ...base, endDate: '2026-02-30' });
    expect(badEnd.success).toBe(false);
    if (!badEnd.success) {
      expect(badEnd.error.issues[0]?.message).toBe('Date invalide.');
    }
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('create_project : la description énumère les templates et types built-in (anti-dérive)', () => {
    const tool = getTool('create_project');
    // Valeurs actuelles de BUILTIN_TEMPLATES / BUILTIN_PROJECT_TYPES — la
    // description est construite depuis les constantes domain.
    expect(tool.description).toContain('creative');
    expect(tool.description).toContain('campagne');
    const typeIdJson = (tool.jsonSchema as { properties: { typeId: { enum: string[] } } })
      .properties.typeId;
    expect(typeIdJson.enum).toContain('campagne');
  });

  it('create_card transmet ctx + input parsé au core et renvoie un JSON avec cardId', async () => {
    cardCoreMocks.createCardCore.mockResolvedValue({
      ok: true,
      cardId: 'c-1',
      shortRef: 7,
      title: 'Test agent',
    });
    const input = { projectId: PROJECT_ID, columnId: COLUMN_ID, title: 'Test agent' };
    const out = await run('create_card', input);
    expect(cardCoreMocks.createCardCore).toHaveBeenCalledWith(ctx, input);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed).toEqual({ created: true, cardId: 'c-1', ref: 7, title: 'Test agent' });
  });

  it('create_card renvoie un message montrable sur échec', async () => {
    cardCoreMocks.createCardCore.mockResolvedValue({ ok: false, message: 'Projet introuvable.' });
    const out = await run('create_card', {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'X',
    });
    expect(out).toBe('Échec : Projet introuvable.');
  });

  it('create_project : dates invalides → message Zod du schéma (fin avant début)', async () => {
    const out = await run('create_project', {
      name: 'Test Assistant',
      clientId: CLIENT_ID,
      templateId: 'creative',
      startDate: '2026-08-01',
      endDate: '2026-01-01',
    });
    expect(out).toBe('Échec : La date de fin doit être après la date de début');
    expect(projectCoreMocks.createProjectCore).not.toHaveBeenCalled();
  });

  it('create_project : succès → JSON avec projectId', async () => {
    projectCoreMocks.createProjectCore.mockResolvedValue({ ok: true, projectId: 'p-1' });
    const out = await run('create_project', {
      name: 'Test Assistant',
      clientId: CLIENT_ID,
      templateId: 'creative',
    });
    expect(JSON.parse(out)).toEqual({ created: true, projectId: 'p-1' });
    expect(projectCoreMocks.createProjectCore).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        name: 'Test Assistant',
        clientId: CLIENT_ID,
        templateId: 'creative',
      }),
    );
  });

  it('create_project : échec core → message montrable', async () => {
    projectCoreMocks.createProjectCore.mockResolvedValue({
      ok: false,
      message: 'Un projet porte déjà ce nom.',
    });
    const out = await run('create_project', {
      name: 'Test Assistant',
      clientId: CLIENT_ID,
      templateId: 'creative',
    });
    expect(out).toBe('Échec : Un projet porte déjà ce nom.');
  });

  it('update_card : succès → relit la carte et renvoie updated/title/categoryTag depuis la DB ; échec → message montrable', async () => {
    updateCardMocks.updateCard.mockResolvedValueOnce({ ok: true });
    prismaMocks.card.findFirst.mockResolvedValueOnce({
      title: 'Titre final',
      categoryTag: 'design',
    });
    const ok = await run('update_card', { cardId: CARD_ID, title: 'Nouveau titre' });
    expect(prismaMocks.card.findFirst).toHaveBeenCalledWith({
      where: { id: CARD_ID, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { title: true, categoryTag: true },
    });
    expect(JSON.parse(ok)).toEqual({ updated: true, title: 'Titre final', categoryTag: 'design' });

    updateCardMocks.updateCard.mockResolvedValueOnce({ ok: false, message: 'Carte introuvable.' });
    const fail = await run('update_card', { cardId: CARD_ID, title: 'X' });
    expect(fail).toBe('Échec : Carte introuvable.');
  });

  it('update_card : categoryTag null en relecture → clé omise du JSON', async () => {
    updateCardMocks.updateCard.mockResolvedValue({ ok: true });
    prismaMocks.card.findFirst.mockResolvedValue({
      title: 'Sans étiquette',
      categoryTag: null,
    });
    const out = await run('update_card', { cardId: CARD_ID, categoryTag: null });
    expect(JSON.parse(out)).toEqual({ updated: true, title: 'Sans étiquette' });
    expect(JSON.parse(out)).not.toHaveProperty('categoryTag');
  });

  it('update_card : relecture introuvable → message "vérification impossible", pas de updated:true', async () => {
    updateCardMocks.updateCard.mockResolvedValue({ ok: true });
    prismaMocks.card.findFirst.mockResolvedValue(null);
    const out = await run('update_card', { cardId: CARD_ID, title: 'X' });
    expect(out).toContain('vérification impossible');
    expect(out).not.toContain('updated');
  });

  it('update_card : mutation ok mais relecture qui LÈVE → "enregistrée … vérification impossible", pas le message générique', async () => {
    updateCardMocks.updateCard.mockResolvedValue({ ok: true });
    prismaMocks.card.findFirst.mockRejectedValue(
      new Error("Can't reach database server at db.xxx.supabase.co"),
    );
    const out = await run('update_card', { cardId: CARD_ID, title: 'X' });
    // La mutation est committée : l'agent ne doit PAS croire à un échec
    // (risque de retry dupliqué) ni recevoir le message d'erreur interne.
    expect(out).toBe('Mise à jour enregistrée mais vérification impossible (erreur technique).');
    expect(out).not.toContain('Erreur interne');
  });

  it('update_card : categoryTag null est transmis (effacement), les clés absentes ne le sont pas', async () => {
    updateCardMocks.updateCard.mockResolvedValue({ ok: true });
    prismaMocks.card.findFirst.mockResolvedValue({
      title: 'Titre',
      categoryTag: null,
    });
    await run('update_card', { cardId: CARD_ID, categoryTag: null });
    // Pin du conditional-spread : null ≠ undefined — la clé doit être présente
    // avec la valeur null, et title/description absents.
    expect(updateCardMocks.updateCard).toHaveBeenCalledWith({ cardId: CARD_ID, categoryTag: null });
  });

  it('set_card_due_date avec autoUnblocked:true → JSON reflète le déblocage', async () => {
    dueDateMocks.updateCardDueDate.mockResolvedValue({
      ok: true,
      autoBlocked: false,
      autoUnblocked: true,
      newColumnId: COLUMN_ID,
      newDueDate: '2026-08-01T00:00:00.000Z',
    });
    const out = await run('set_card_due_date', { cardId: CARD_ID, dueDate: '2026-08-01' });
    expect(JSON.parse(out)).toEqual({
      updated: true,
      autoBlocked: false,
      autoUnblocked: true,
      newDueDate: '2026-08-01T00:00:00.000Z',
    });
  });

  it('set_card_due_date : échec → message montrable', async () => {
    dueDateMocks.updateCardDueDate.mockResolvedValue({ ok: false, message: 'Carte introuvable.' });
    const out = await run('set_card_due_date', { cardId: CARD_ID, dueDate: null });
    expect(out).toBe('Échec : Carte introuvable.');
  });

  it('move_card : {ok:false,message} → message renvoyé tel quel', async () => {
    const message = 'La colonne « Bloqué » est gérée automatiquement par le système.';
    moveCardMocks.moveCard.mockResolvedValue({ ok: false, message });
    const out = await run('move_card', {
      cardId: CARD_ID,
      targetColumnId: COLUMN_ID,
      targetIndex: 0,
    });
    expect(out).toContain(message);
  });

  it('move_card : succès → relit la carte et renvoie nowInColumn/position depuis la DB', async () => {
    moveCardMocks.moveCard.mockResolvedValue({ ok: true, position: 9999 });
    prismaMocks.card.findFirst.mockResolvedValue({
      columnId: COLUMN_ID,
      position: 2048,
      column: { name: 'Fait' },
    });
    const out = await run('move_card', {
      cardId: CARD_ID,
      targetColumnId: COLUMN_ID,
      targetIndex: 1,
    });
    expect(prismaMocks.card.findFirst).toHaveBeenCalledWith({
      where: { id: CARD_ID, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { columnId: true, position: true, column: { select: { name: true } } },
    });
    // `position` vient de la RELECTURE (2048), pas du résultat de la
    // mutation (9999) — l'état renvoyé est intégralement constaté en DB.
    expect(JSON.parse(out)).toEqual({ moved: true, nowInColumn: 'Fait', position: 2048 });
  });

  it('move_card : relecture introuvable → message "vérification impossible", pas de moved:true', async () => {
    moveCardMocks.moveCard.mockResolvedValue({ ok: true, position: 2048 });
    prismaMocks.card.findFirst.mockResolvedValue(null);
    const out = await run('move_card', {
      cardId: CARD_ID,
      targetColumnId: COLUMN_ID,
      targetIndex: 1,
    });
    expect(out).toContain('vérification impossible');
    expect(out).not.toContain('moved');
  });

  it('move_card : mutation ok mais relecture qui LÈVE → "enregistré … vérification impossible", pas le message générique', async () => {
    moveCardMocks.moveCard.mockResolvedValue({ ok: true, position: 2048 });
    prismaMocks.card.findFirst.mockRejectedValue(
      new Error("Can't reach database server at db.xxx.supabase.co"),
    );
    const out = await run('move_card', {
      cardId: CARD_ID,
      targetColumnId: COLUMN_ID,
      targetIndex: 1,
    });
    // La mutation est committée : l'agent ne doit PAS croire à un échec
    // (risque de retry dupliqué) ni recevoir le message d'erreur interne.
    expect(out).toBe('Déplacement enregistré mais vérification impossible (erreur technique).');
    expect(out).not.toContain('Erreur interne');
  });

  it('add_card_assignee transmet le raci tel quel', async () => {
    assigneeMocks.addCardAssignee.mockResolvedValue({ ok: true });
    const out = await run('add_card_assignee', {
      cardId: CARD_ID,
      userId: USER_ID,
      raci: 'approver',
    });
    expect(assigneeMocks.addCardAssignee).toHaveBeenCalledWith({
      cardId: CARD_ID,
      userId: USER_ID,
      raci: 'approver',
    });
    expect(JSON.parse(out)).toEqual({ assigned: true, userId: USER_ID, raci: 'approver' });
  });

  it('add_card_assignee : échec (ex. déjà un responsible) → message montrable', async () => {
    assigneeMocks.addCardAssignee.mockResolvedValue({
      ok: false,
      message:
        'Une seule personne peut être Responsable. Réassignez le Responsable actuel d’abord.',
    });
    const out = await run('add_card_assignee', {
      cardId: CARD_ID,
      userId: USER_ID,
      raci: 'responsible',
    });
    expect(out).toContain('Échec :');
    expect(out).toContain('Responsable');
  });

  it('remove_card_assignee : succès → {removed:true} ; échec → message montrable', async () => {
    assigneeMocks.removeCardAssignee.mockResolvedValueOnce({ ok: true });
    const ok = await run('remove_card_assignee', { cardId: CARD_ID, userId: USER_ID });
    expect(JSON.parse(ok)).toEqual({ removed: true });

    assigneeMocks.removeCardAssignee.mockResolvedValueOnce({
      ok: false,
      message: 'Carte introuvable.',
    });
    const fail = await run('remove_card_assignee', { cardId: CARD_ID, userId: USER_ID });
    expect(fail).toBe('Échec : Carte introuvable.');
  });

  it('delete_card est gated:true et wrappe deleteCardCore(ctx, …)', async () => {
    const tool = getTool('delete_card');
    expect(tool.gated).toBe(true);

    cardCoreMocks.deleteCardCore.mockResolvedValue({ ok: true });
    const ok = await run('delete_card', { cardId: CARD_ID });
    expect(cardCoreMocks.deleteCardCore).toHaveBeenCalledWith(ctx, { cardId: CARD_ID });
    expect(ok).toBe('Carte supprimée (restaurable 30 jours).');

    cardCoreMocks.deleteCardCore.mockResolvedValue({ ok: false, message: 'Carte introuvable.' });
    const fail = await run('delete_card', { cardId: CARD_ID });
    expect(fail).toBe('Échec : Carte introuvable.');
  });

  it('update_project : transmet ctx + champs fournis au core (conditional-spread) et renvoie le post-état JSON', async () => {
    projectCoreMocks.updateProjectCore.mockResolvedValue({
      ok: true,
      name: 'Nouveau nom',
      description: null,
      startDate: '2026-08-01',
      endDate: null,
    });
    const out = await run('update_project', {
      projectId: PROJECT_ID,
      name: 'Nouveau nom',
      startDate: '2026-08-01',
    });
    expect(projectCoreMocks.updateProjectCore).toHaveBeenCalledWith(ctx, {
      projectId: PROJECT_ID,
      name: 'Nouveau nom',
      startDate: '2026-08-01',
    });
    expect(JSON.parse(out)).toEqual({
      updated: true,
      name: 'Nouveau nom',
      description: null,
      startDate: '2026-08-01',
      endDate: null,
    });
  });

  it('update_project : les champs absents ne sont pas transmis ; null (effacement) l’est', async () => {
    projectCoreMocks.updateProjectCore.mockResolvedValue({
      ok: true,
      name: 'X',
      description: null,
      startDate: null,
      endDate: null,
    });
    await run('update_project', { projectId: PROJECT_ID, description: null });
    expect(projectCoreMocks.updateProjectCore).toHaveBeenCalledWith(ctx, {
      projectId: PROJECT_ID,
      description: null,
    });
  });

  it('update_project : échec core → message montrable', async () => {
    projectCoreMocks.updateProjectCore.mockResolvedValue({
      ok: false,
      message: 'La date de fin doit être après la date de début',
    });
    const out = await run('update_project', { projectId: PROJECT_ID, startDate: '2026-08-01' });
    expect(out).toBe('Échec : La date de fin doit être après la date de début');
  });

  it('update_project : le schéma refuse une date calendaire inexistante (2026-02-30) et accepte null (effacement)', () => {
    const schema = getTool('update_project').inputSchema as z.ZodTypeAny;
    const bad = schema.safeParse({ projectId: PROJECT_ID, startDate: '2026-02-30' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe('Date invalide.');
    }
    expect(schema.safeParse({ projectId: PROJECT_ID, startDate: null }).success).toBe(true);
    expect(schema.safeParse({ projectId: PROJECT_ID, endDate: null }).success).toBe(true);
    expect(schema.safeParse({ projectId: PROJECT_ID, description: null }).success).toBe(true);
    expect(schema.safeParse({ projectId: PROJECT_ID }).success).toBe(true);
  });

  it('delete_project est gated:true et wrappe deleteProjectCore(ctx, …)', async () => {
    const tool = getTool('delete_project');
    expect(tool.gated).toBe(true);

    projectCoreMocks.deleteProjectCore.mockResolvedValue({ ok: true });
    const ok = await run('delete_project', { projectId: PROJECT_ID });
    expect(projectCoreMocks.deleteProjectCore).toHaveBeenCalledWith(ctx, { projectId: PROJECT_ID });
    expect(ok).toBe('Projet supprimé (corbeille 30 jours).');

    projectCoreMocks.deleteProjectCore.mockResolvedValue({
      ok: false,
      message: 'Projet introuvable.',
    });
    const fail = await run('delete_project', { projectId: PROJECT_ID });
    expect(fail).toBe('Échec : Projet introuvable.');
  });

  it('delete_project : describeForConfirm lit le nom + le compte de cartes réels en DB (input = id seul, jamais de nom fourni), et reste prudent si introuvable', async () => {
    const tool = getTool('delete_project');
    const describe = tool.describeForConfirm as (input: unknown) => Promise<string>;

    prismaMocks.project.findFirst.mockResolvedValueOnce({
      name: 'Campagne été',
      _count: { cards: 3 },
    });
    const found = await describe({ projectId: PROJECT_ID });
    expect(prismaMocks.project.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: PROJECT_ID, workspaceId: ctx.workspaceId, deletedAt: null }, {}] },
      select: { name: true, _count: { select: { cards: { where: { deletedAt: null } } } } },
    });
    expect(found).toBe('Supprimer le projet « Campagne été » (3 cartes) — restaurable 30 jours ?');

    prismaMocks.project.findFirst.mockResolvedValueOnce({
      name: 'Solo',
      _count: { cards: 1 },
    });
    const singular = await describe({ projectId: PROJECT_ID });
    expect(singular).toBe('Supprimer le projet « Solo » (1 carte) — restaurable 30 jours ?');

    prismaMocks.project.findFirst.mockResolvedValueOnce(null);
    const missing = await describe({ projectId: PROJECT_ID });
    expect(missing).toBe('Supprimer un projet introuvable dans ce workspace ?');
  });

  it('delete_project : describeForConfirm re-valide l’input BRUT — {} ou id structuré ({not:null}) → libellé prudent SANS aucun appel prisma', async () => {
    // Le gate précède la validation Zod du registry : sans re-parse local,
    // Prisma 6 ignorerait `id: undefined` (findFirst → PREMIER projet du
    // workspace) et accepterait un objet comme filtre structuré — le dialog
    // nommerait le mauvais objet.
    const describe = getTool('delete_project').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;

    const empty = await describe({});
    expect(empty).toBe('Supprimer un projet introuvable dans ce workspace ?');
    expect(prismaMocks.project.findFirst).not.toHaveBeenCalled();

    const structured = await describe({ projectId: { not: null } });
    expect(structured).toBe('Supprimer un projet introuvable dans ce workspace ?');
    expect(prismaMocks.project.findFirst).not.toHaveBeenCalled();
    expect(scopeMocks.loadUserScope).not.toHaveBeenCalled();
  });

  it('delete_project : describeForConfirm applique le scope restricted (AND scopedProjectWhere) — hors scope → libellé « introuvable », nom réel jamais présent', async () => {
    const describe = getTool('delete_project').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: [],
      projectIds: ['scope-p1'],
    });
    scopeMocks.scopedProjectWhere.mockReturnValueOnce({ id: { in: ['scope-p1'] } });
    // Projet réel hors scope : le filtre scoped le rend invisible → null.
    prismaMocks.project.findFirst.mockResolvedValueOnce(null);

    const out = await describe({ projectId: PROJECT_ID });

    expect(prismaMocks.project.findFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: PROJECT_ID, workspaceId: ctx.workspaceId, deletedAt: null },
          { id: { in: ['scope-p1'] } },
        ],
      },
      select: { name: true, _count: { select: { cards: { where: { deletedAt: null } } } } },
    });
    // Même texte que l'inexistant : ne pas révéler que le projet existe.
    expect(out).toBe('Supprimer un projet introuvable dans ce workspace ?');
    expect(out).not.toContain('Campagne');
  });

  it('add_column : transmet ctx + input au core et renvoie {created, columnId, columns}', async () => {
    columnCoreMocks.addColumnCore.mockResolvedValue({
      ok: true,
      columnId: 'col-1',
      columns: [{ id: 'col-1', name: 'Idée', position: 1024 }],
    });
    const out = await run('add_column', { projectId: PROJECT_ID, name: 'Idée' });
    expect(columnCoreMocks.addColumnCore).toHaveBeenCalledWith(ctx, {
      projectId: PROJECT_ID,
      name: 'Idée',
    });
    expect(JSON.parse(out)).toEqual({
      created: true,
      columnId: 'col-1',
      columns: [{ id: 'col-1', name: 'Idée', position: 1024 }],
    });
  });

  it('add_column : échec core → message montrable', async () => {
    columnCoreMocks.addColumnCore.mockResolvedValue({
      ok: false,
      message: 'Nom de colonne requis.',
    });
    const out = await run('add_column', { projectId: PROJECT_ID, name: 'X' });
    expect(out).toBe('Échec : Nom de colonne requis.');
  });

  it('rename_column : transmet ctx + input au core et renvoie {renamed, name}', async () => {
    columnCoreMocks.renameColumnCore.mockResolvedValue({ ok: true, name: 'Créa v2' });
    const out = await run('rename_column', { columnId: COLUMN_ID, name: 'Créa v2' });
    expect(columnCoreMocks.renameColumnCore).toHaveBeenCalledWith(ctx, {
      columnId: COLUMN_ID,
      name: 'Créa v2',
    });
    expect(JSON.parse(out)).toEqual({ renamed: true, name: 'Créa v2' });
  });

  it('rename_column : échec core (Bloqué verrouillée) → message montrable', async () => {
    columnCoreMocks.renameColumnCore.mockResolvedValue({
      ok: false,
      message: 'La colonne « Bloqué » est gérée par le système et ne peut pas être modifiée.',
    });
    const out = await run('rename_column', { columnId: COLUMN_ID, name: 'X' });
    expect(out).toBe(
      'Échec : La colonne « Bloqué » est gérée par le système et ne peut pas être modifiée.',
    );
  });

  it('reorder_columns : transmet ctx + input au core et renvoie {reordered, columns}', async () => {
    const orderedColumnIds = [COLUMN_ID, PROJECT_ID];
    columnCoreMocks.reorderColumnsCore.mockResolvedValue({ ok: true, columns: [] });
    const out = await run('reorder_columns', { projectId: PROJECT_ID, orderedColumnIds });
    expect(columnCoreMocks.reorderColumnsCore).toHaveBeenCalledWith(ctx, {
      projectId: PROJECT_ID,
      orderedColumnIds,
    });
    expect(JSON.parse(out)).toEqual({ reordered: true, columns: [] });
  });

  it('reorder_columns : échec core (liste incomplète/doublon) → message montrable', async () => {
    columnCoreMocks.reorderColumnsCore.mockResolvedValue({
      ok: false,
      message:
        'La liste doit contenir exactement toutes les colonnes du projet (hors « Bloqué »), sans doublon.',
    });
    const out = await run('reorder_columns', {
      projectId: PROJECT_ID,
      orderedColumnIds: [COLUMN_ID],
    });
    expect(out).toBe(
      'Échec : La liste doit contenir exactement toutes les colonnes du projet (hors « Bloqué »), sans doublon.',
    );
  });

  it('delete_column est gated:true et wrappe deleteColumnCore(ctx, …)', async () => {
    const tool = getTool('delete_column');
    expect(tool.gated).toBe(true);

    columnCoreMocks.deleteColumnCore.mockResolvedValue({
      ok: true,
      movedCards: 2,
      movedTo: 'Brief',
      columns: [],
    });
    const out = await run('delete_column', { columnId: COLUMN_ID });
    expect(columnCoreMocks.deleteColumnCore).toHaveBeenCalledWith(ctx, { columnId: COLUMN_ID });
    expect(JSON.parse(out)).toEqual({
      deleted: true,
      movedCards: 2,
      movedTo: 'Brief',
      columns: [],
    });

    columnCoreMocks.deleteColumnCore.mockResolvedValue({
      ok: false,
      message: 'Impossible de supprimer la dernière colonne du projet.',
    });
    const fail = await run('delete_column', { columnId: COLUMN_ID });
    expect(fail).toBe('Échec : Impossible de supprimer la dernière colonne du projet.');
  });

  it('delete_column : describeForConfirm lit le nom + le compte de cartes réels en DB (input = id seul), colonne vide vs non vide vs introuvable', async () => {
    const tool = getTool('delete_column');
    const describe = tool.describeForConfirm as (input: unknown) => Promise<string>;

    prismaMocks.column.findFirst.mockResolvedValueOnce({ name: 'Brief', isBlockedSystem: false });
    prismaMocks.card.count.mockResolvedValueOnce(0);
    const empty = await describe({ columnId: COLUMN_ID });
    expect(prismaMocks.column.findFirst).toHaveBeenCalledWith({
      where: {
        id: COLUMN_ID,
        project: { AND: [{ workspaceId: ctx.workspaceId, deletedAt: null }, {}] },
      },
      select: { name: true, isBlockedSystem: true },
    });
    expect(empty).toBe('Supprimer la colonne vide « Brief » ?');

    prismaMocks.column.findFirst.mockResolvedValueOnce({ name: 'Créa', isBlockedSystem: false });
    prismaMocks.card.count.mockResolvedValueOnce(4);
    const nonEmpty = await describe({ columnId: COLUMN_ID });
    expect(nonEmpty).toBe(
      'Supprimer la colonne « Créa » et déplacer ses 4 cartes vers la première colonne du projet ?',
    );

    prismaMocks.column.findFirst.mockResolvedValueOnce({ name: 'Solo', isBlockedSystem: false });
    prismaMocks.card.count.mockResolvedValueOnce(1);
    const singular = await describe({ columnId: COLUMN_ID });
    expect(singular).toBe(
      'Supprimer la colonne « Solo » et déplacer ses 1 carte vers la première colonne du projet ?',
    );

    prismaMocks.column.findFirst.mockResolvedValueOnce(null);
    const missing = await describe({ columnId: COLUMN_ID });
    expect(missing).toBe('Supprimer une colonne introuvable dans ce workspace ?');
  });

  it('delete_column : describeForConfirm re-valide l’input BRUT — {} ou id structuré → libellé prudent SANS aucun appel prisma', async () => {
    const describe = getTool('delete_column').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;

    const empty = await describe({});
    expect(empty).toBe('Supprimer une colonne introuvable dans ce workspace ?');
    expect(prismaMocks.column.findFirst).not.toHaveBeenCalled();

    const structured = await describe({ columnId: { not: null } });
    expect(structured).toBe('Supprimer une colonne introuvable dans ce workspace ?');
    expect(prismaMocks.column.findFirst).not.toHaveBeenCalled();
    expect(prismaMocks.card.count).not.toHaveBeenCalled();
    expect(scopeMocks.loadUserScope).not.toHaveBeenCalled();
  });

  it('delete_column : describeForConfirm applique le scope restricted via le join projet — hors scope → « introuvable », nom réel jamais présent', async () => {
    const describe = getTool('delete_column').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: [],
      projectIds: ['scope-p1'],
    });
    scopeMocks.scopedProjectWhere.mockReturnValueOnce({ id: { in: ['scope-p1'] } });
    prismaMocks.column.findFirst.mockResolvedValueOnce(null);

    const out = await describe({ columnId: COLUMN_ID });

    expect(prismaMocks.column.findFirst).toHaveBeenCalledWith({
      where: {
        id: COLUMN_ID,
        project: {
          AND: [{ workspaceId: ctx.workspaceId, deletedAt: null }, { id: { in: ['scope-p1'] } }],
        },
      },
      select: { name: true, isBlockedSystem: true },
    });
    // Même texte que l'inexistant : ne pas révéler que la colonne existe.
    expect(out).toBe('Supprimer une colonne introuvable dans ce workspace ?');
    expect(out).not.toContain('Brief');
    expect(prismaMocks.card.count).not.toHaveBeenCalled();
  });

  it('delete_column : describeForConfirm sur la colonne système « Bloqué » → refus explicite, sans compter les cartes', async () => {
    const describe = getTool('delete_column').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.column.findFirst.mockResolvedValueOnce({ name: 'Bloqué', isBlockedSystem: true });

    const out = await describe({ columnId: COLUMN_ID });

    expect(out).toBe(
      'La colonne « Bloqué » est gérée par le système et ne peut pas être supprimée.',
    );
    expect(prismaMocks.card.count).not.toHaveBeenCalled();
  });

  it('update_project : le schéma borne name à 120 caractères (aligné sur validateProjectName du domain)', () => {
    const schema = getTool('update_project').inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({ projectId: PROJECT_ID, name: 'a'.repeat(120) }).success).toBe(true);
    expect(schema.safeParse({ projectId: PROJECT_ID, name: 'a'.repeat(121) }).success).toBe(false);
    const maxLength = (
      getTool('update_project').jsonSchema as {
        properties: { name: { maxLength: number } };
      }
    ).properties.name.maxLength;
    expect(maxLength).toBe(120);
  });
});
