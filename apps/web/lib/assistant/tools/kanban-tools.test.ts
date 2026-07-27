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

const projectCoreMocks = vi.hoisted(() => ({ createProjectCore: vi.fn() }));
vi.mock('@/features/projects/lib/project-core', () => projectCoreMocks);

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
});

describe('buildKanbanTools', () => {
  it('expose les 8 tools mutants, seul delete_card gated, aucun adminOnly', () => {
    const list = tools();
    expect(list.map((t) => t.name).sort()).toEqual([
      'add_card_assignee',
      'create_card',
      'create_project',
      'delete_card',
      'move_card',
      'remove_card_assignee',
      'set_card_due_date',
      'update_card',
    ]);
    expect(list.every((t) => !t.adminOnly)).toBe(true);
    for (const t of list) {
      expect(t.gated).toBe(t.name === 'delete_card');
    }
  });

  it('jsonSchema.required correspond aux clés requises du schéma Zod, pour chaque tool', () => {
    for (const t of tools()) {
      const jsonRequired = [...((t.jsonSchema as { required?: string[] }).required ?? [])].sort();
      const zodRequired = requiredKeys(t.inputSchema as z.ZodTypeAny).sort();
      expect(jsonRequired, `mismatch on ${t.name}`).toEqual(zodRequired);
    }
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

  it('update_card : succès → {updated:true} ; échec → message montrable', async () => {
    updateCardMocks.updateCard.mockResolvedValueOnce({ ok: true });
    const ok = await run('update_card', { cardId: CARD_ID, title: 'Nouveau titre' });
    expect(JSON.parse(ok)).toEqual({ updated: true });

    updateCardMocks.updateCard.mockResolvedValueOnce({ ok: false, message: 'Carte introuvable.' });
    const fail = await run('update_card', { cardId: CARD_ID, title: 'X' });
    expect(fail).toBe('Échec : Carte introuvable.');
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

  it('move_card : succès → JSON avec position', async () => {
    moveCardMocks.moveCard.mockResolvedValue({ ok: true, position: 2048 });
    const out = await run('move_card', {
      cardId: CARD_ID,
      targetColumnId: COLUMN_ID,
      targetIndex: 1,
    });
    expect(JSON.parse(out)).toEqual({ moved: true, position: 2048 });
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
});
