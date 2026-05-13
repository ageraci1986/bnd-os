import { describe, expect, it } from 'vitest';
import { reduceEditorState, makeInitialState, type EditorState } from './use-editor-state';
import { DESCRIPTION_ITEM_ID, type CardTemplateItem } from '@nexushub/domain';

const baseTemplate = {
  id: 't1',
  name: 'Tâche standard',
  items: [
    { id: 'title', type: 'text' as const, label: 'Titre' },
    { id: DESCRIPTION_ITEM_ID, type: 'description' as const },
  ] as readonly CardTemplateItem[],
};

describe('reduceEditorState', () => {
  it('selectTemplate loads the draft', () => {
    const initial = makeInitialState([baseTemplate]);
    const next = reduceEditorState(initial, { type: 'selectTemplate', id: 't1' });
    expect(next.selectedId).toBe('t1');
    expect(next.draft).toEqual({
      name: 'Tâche standard',
      items: baseTemplate.items,
      isDefault: false,
    });
    expect(next.isDirty).toBe(false);
  });

  it('renameDraft marks dirty', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'renameDraft', name: 'Autre nom' });
    expect(s2.draft?.name).toBe('Autre nom');
    expect(s2.isDirty).toBe(true);
  });

  it('addItem appends with default label and opens drawer on it', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'addItem', itemType: 'text' });
    expect(s2.draft?.items.length).toBe(3);
    const added = s2.draft!.items[2]!;
    expect(added.type).toBe('text');
    expect(s2.editingItemId).toBe(added.id);
    expect(s2.isDirty).toBe(true);
  });

  it('addItem of type description is rejected when description already present', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'addItem', itemType: 'description' });
    expect(s2.draft?.items.length).toBe(2);
  });

  it('removeItem drops the item and closes the drawer if it was open', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2: EditorState = { ...s1, editingItemId: 'title' };
    const s3 = reduceEditorState(s2, { type: 'removeItem', id: 'title' });
    expect(s3.draft?.items.map((i) => i.id)).toEqual([DESCRIPTION_ITEM_ID]);
    expect(s3.editingItemId).toBeNull();
  });

  it('reorderItems swaps positions', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'reorderItems', from: 0, to: 1 });
    expect(s2.draft?.items.map((i) => i.id)).toEqual([DESCRIPTION_ITEM_ID, 'title']);
  });

  it('updateItem patches an input item live', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, {
      type: 'updateItem',
      id: 'title',
      patch: { label: 'Nouveau' },
    });
    const updated = s2.draft!.items[0]!;
    expect(updated.type).toBe('text');
    if (updated.type === 'text') expect(updated.label).toBe('Nouveau');
  });

  it('convertItemType keeps label, replaces options on select→text', () => {
    const tplWithSelect = {
      id: 't2',
      name: 'X',
      items: [
        { id: 's', type: 'select' as const, label: 'S', options: ['a', 'b'] },
      ] as readonly CardTemplateItem[],
    };
    const s1 = reduceEditorState(makeInitialState([tplWithSelect]), {
      type: 'selectTemplate',
      id: 't2',
    });
    const s2 = reduceEditorState(s1, { type: 'convertItemType', id: 's', toType: 'text' });
    const updated = s2.draft!.items[0]!;
    expect(updated.type).toBe('text');
    if (updated.type === 'text') expect(updated.label).toBe('S');
    expect('options' in updated).toBe(false);
  });

  it('convertItemType text→select initializes empty options', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'convertItemType', id: 'title', toType: 'select' });
    const updated = s2.draft!.items[0]!;
    expect(updated.type).toBe('select');
    if (updated.type === 'select') expect(updated.options).toEqual([]);
  });

  it('saved clears dirty + replaces the template in the cache', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'renameDraft', name: 'Renommé' });
    const s3 = reduceEditorState(s2, {
      type: 'saved',
      template: { ...baseTemplate, name: 'Renommé' },
    });
    expect(s3.isDirty).toBe(false);
    expect(s3.templates.find((t) => t.id === 't1')?.name).toBe('Renommé');
  });
});
