import { describe, expect, it } from 'vitest';
import { validateCardTemplateItems, DESCRIPTION_ITEM_ID, CHECKLIST_ITEM_ID } from './index';

describe('validateCardTemplateItems', () => {
  it('returns [] for an empty array', () => {
    expect(validateCardTemplateItems([])).toEqual([]);
  });

  it('returns null for non-array input', () => {
    expect(validateCardTemplateItems(null)).toBeNull();
    expect(validateCardTemplateItems('foo')).toBeNull();
    expect(validateCardTemplateItems({})).toBeNull();
  });

  it('accepts a mix of input, section and description items', () => {
    const items = [
      { id: 'a', type: 'text', label: 'Titre' },
      { id: 's1', type: 'section', label: 'Brief' },
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
      { id: 'b', type: 'select', label: 'Statut', options: ['todo', 'doing'] },
    ];
    expect(validateCardTemplateItems(items)).toEqual(items);
  });

  it('rejects more than one description item', () => {
    const items = [
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
    ];
    expect(validateCardTemplateItems(items)).toBeNull();
  });

  it('rejects duplicate ids on non-description items', () => {
    const items = [
      { id: 'dup', type: 'text', label: 'A' },
      { id: 'dup', type: 'text', label: 'B' },
    ];
    expect(validateCardTemplateItems(items)).toBeNull();
  });

  it('rejects a select without options', () => {
    expect(validateCardTemplateItems([{ id: 'x', type: 'select', label: 'X' }])).toBeNull();
  });

  it('rejects a select with an empty options array', () => {
    expect(
      validateCardTemplateItems([{ id: 'x', type: 'select', label: 'X', options: [] }]),
    ).toBeNull();
  });

  it('rejects a section without a label', () => {
    expect(validateCardTemplateItems([{ id: 's1', type: 'section' }])).toBeNull();
  });

  it('rejects unknown types', () => {
    expect(validateCardTemplateItems([{ id: 'x', type: 'unknown', label: 'X' }])).toBeNull();
  });

  it('rejects a description marker with a wrong id', () => {
    expect(validateCardTemplateItems([{ id: 'desc', type: 'description' }])).toBeNull();
  });

  it('strips unknown properties on input items', () => {
    const result = validateCardTemplateItems([
      { id: 'a', type: 'text', label: 'A', group: 'overview', foo: 'bar' },
    ]);
    expect(result).toEqual([{ id: 'a', type: 'text', label: 'A' }]);
  });

  it('trims and rejects empty labels', () => {
    expect(validateCardTemplateItems([{ id: 'a', type: 'text', label: '  ' }])).toBeNull();
  });

  it('rejects items list longer than 60', () => {
    const items = Array.from({ length: 61 }, (_, i) => ({
      id: `f${i}`,
      type: 'text',
      label: `F ${i}`,
    }));
    expect(validateCardTemplateItems(items)).toBeNull();
  });

  it('rejects a non-description item using the reserved description id', () => {
    expect(validateCardTemplateItems([{ id: 'description', type: 'text', label: 'X' }])).toBeNull();
  });

  it('accepts a checklist item with default items, trimmed', () => {
    const items = [{ id: CHECKLIST_ITEM_ID, type: 'checklist', items: ['  Draft ', 'Review'] }];
    expect(validateCardTemplateItems(items)).toEqual([
      { id: CHECKLIST_ITEM_ID, type: 'checklist', items: ['Draft', 'Review'] },
    ]);
  });

  it('accepts a checklist item with empty default list', () => {
    expect(
      validateCardTemplateItems([{ id: CHECKLIST_ITEM_ID, type: 'checklist', items: [] }]),
    ).toEqual([{ id: CHECKLIST_ITEM_ID, type: 'checklist', items: [] }]);
  });

  it('rejects more than one checklist item', () => {
    const items = [
      { id: CHECKLIST_ITEM_ID, type: 'checklist', items: [] },
      { id: CHECKLIST_ITEM_ID, type: 'checklist', items: [] },
    ];
    expect(validateCardTemplateItems(items)).toBeNull();
  });

  it('rejects a checklist item with wrong id', () => {
    expect(validateCardTemplateItems([{ id: 'cl', type: 'checklist', items: [] }])).toBeNull();
  });

  it('rejects a checklist item with a non-string default', () => {
    expect(
      validateCardTemplateItems([{ id: CHECKLIST_ITEM_ID, type: 'checklist', items: ['ok', 42] }]),
    ).toBeNull();
  });

  it('rejects a non-checklist item using the reserved checklist id', () => {
    expect(
      validateCardTemplateItems([{ id: CHECKLIST_ITEM_ID, type: 'text', label: 'X' }]),
    ).toBeNull();
  });
});
