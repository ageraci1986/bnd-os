import { describe, expect, it } from 'vitest';
import { pruneFieldValuesByItems, type CardTemplateItem, DESCRIPTION_ITEM_ID } from './index';

describe('pruneFieldValuesByItems', () => {
  it('returns {} for empty items', () => {
    expect(pruneFieldValuesByItems({ a: '1' }, [])).toEqual({});
  });

  it('keeps values for input items only', () => {
    const items: CardTemplateItem[] = [
      { id: 'title', type: 'text', label: 'T' },
      { id: 's1', type: 'section', label: 'Brief' },
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
      { id: 'when', type: 'date', label: 'W' },
    ];
    const values = { title: 'Hello', when: '2026-05-11', orphan: 'x', s1: 'should drop' };
    expect(pruneFieldValuesByItems(values, items)).toEqual({
      title: 'Hello',
      when: '2026-05-11',
    });
  });

  it('drops non-string values', () => {
    const items: CardTemplateItem[] = [{ id: 'a', type: 'text', label: 'A' }];
    const values: Record<string, unknown> = { a: 42, b: 'kept-not' };
    expect(pruneFieldValuesByItems(values, items)).toEqual({});
  });
});
