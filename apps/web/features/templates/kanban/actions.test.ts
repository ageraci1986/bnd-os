import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  kanbanCreate: vi.fn(),
  kanbanFindFirst: vi.fn(),
  kanbanUpdate: vi.fn(),
  kanbanColumnCreateMany: vi.fn(),
  kanbanColumnDeleteMany: vi.fn(),
  cardTemplateFindFirst: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    kanbanTemplate: {
      create: mocks.kanbanCreate,
      findFirst: mocks.kanbanFindFirst,
      update: mocks.kanbanUpdate,
    },
    kanbanTemplateColumn: {
      createMany: mocks.kanbanColumnCreateMany,
      deleteMany: mocks.kanbanColumnDeleteMany,
    },
    cardTemplate: { findFirst: mocks.cardTemplateFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { createKanbanTemplate, updateKanbanTemplate } from './actions';

const KANBAN_ID = '11111111-1111-1111-1111-111111111111';
const CARD_TPL_ID = '22222222-2222-2222-2222-222222222222';
const FOREIGN_CARD_TPL_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'u-1',
    workspaceId: 'ws-1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'admin@test',
  });
  mocks.kanbanCreate.mockResolvedValue({ id: KANBAN_ID });
  mocks.kanbanFindFirst.mockResolvedValue({ id: KANBAN_ID });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      kanbanTemplate: { update: mocks.kanbanUpdate },
      kanbanTemplateColumn: {
        deleteMany: mocks.kanbanColumnDeleteMany,
        createMany: mocks.kanbanColumnCreateMany,
      },
    }),
  );
});

describe('createKanbanTemplate (defaultCardTemplateId)', () => {
  it('passes the validated card-template id through to the create call', async () => {
    mocks.cardTemplateFindFirst.mockResolvedValueOnce({ id: CARD_TPL_ID });
    const res = await createKanbanTemplate({
      name: 'Brief',
      columns: [{ name: 'À faire', stepChecklist: [] }],
      defaultCardTemplateId: CARD_TPL_ID,
    });
    expect(res).toEqual({ ok: true, id: KANBAN_ID });
    const args = mocks.kanbanCreate.mock.calls[0]![0];
    expect(args.data.defaultCardTemplateId).toBe(CARD_TPL_ID);
  });

  it('refuses a card-template id belonging to another workspace', async () => {
    // The defence-in-depth lookup is scoped by workspaceId, so the foreign
    // template surfaces as `null` regardless of whether the row exists.
    mocks.cardTemplateFindFirst.mockResolvedValueOnce(null);
    const res = await createKanbanTemplate({
      name: 'Brief',
      columns: [{ name: 'À faire', stepChecklist: [] }],
      defaultCardTemplateId: FOREIGN_CARD_TPL_ID,
    });
    expect(res).toEqual({ ok: false, message: 'Template de carte introuvable.' });
    expect(mocks.kanbanCreate).not.toHaveBeenCalled();
  });

  it('omits the field when input is undefined (no override)', async () => {
    const res = await createKanbanTemplate({
      name: 'Brief',
      columns: [{ name: 'À faire', stepChecklist: [] }],
    });
    expect(res).toEqual({ ok: true, id: KANBAN_ID });
    // workspaceId is set; defaultCardTemplateId is not in the data object
    const args = mocks.kanbanCreate.mock.calls[0]![0];
    expect('defaultCardTemplateId' in args.data).toBe(false);
    expect(mocks.cardTemplateFindFirst).not.toHaveBeenCalled();
  });

  it('clears the override when input is explicit null', async () => {
    const res = await createKanbanTemplate({
      name: 'Brief',
      columns: [{ name: 'À faire', stepChecklist: [] }],
      defaultCardTemplateId: null,
    });
    expect(res).toEqual({ ok: true, id: KANBAN_ID });
    const args = mocks.kanbanCreate.mock.calls[0]![0];
    expect(args.data.defaultCardTemplateId).toBeNull();
    expect(mocks.cardTemplateFindFirst).not.toHaveBeenCalled();
  });
});

describe('updateKanbanTemplate (defaultCardTemplateId)', () => {
  it('writes the resolved card-template id inside the transaction', async () => {
    mocks.cardTemplateFindFirst.mockResolvedValueOnce({ id: CARD_TPL_ID });
    const res = await updateKanbanTemplate({
      id: KANBAN_ID,
      name: 'Brief',
      columns: [{ name: 'À faire', stepChecklist: [] }],
      defaultCardTemplateId: CARD_TPL_ID,
    });
    expect(res).toEqual({ ok: true, id: KANBAN_ID });
    const args = mocks.kanbanUpdate.mock.calls[0]![0];
    expect(args.data.defaultCardTemplateId).toBe(CARD_TPL_ID);
  });
});
