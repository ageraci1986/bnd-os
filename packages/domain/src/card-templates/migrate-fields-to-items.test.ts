import { describe, expect, it } from 'vitest';
import { migrateFieldsToItems, DESCRIPTION_ITEM_ID, type CardFieldDef } from './index';

describe('migrateFieldsToItems', () => {
  const fields: CardFieldDef[] = [
    { id: 'title', type: 'text', label: 'Titre', group: 'overview' },
    { id: 'platform', type: 'select', label: 'Platform', options: ['IG', 'FB'] },
  ];

  it('strips group and appends description marker for after-fields', () => {
    expect(migrateFieldsToItems(fields, 'after-fields')).toEqual([
      { id: 'title', type: 'text', label: 'Titre' },
      { id: 'platform', type: 'select', label: 'Platform', options: ['IG', 'FB'] },
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
    ]);
  });

  it('prepends description marker for before-fields', () => {
    expect(migrateFieldsToItems(fields, 'before-fields')).toEqual([
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
      { id: 'title', type: 'text', label: 'Titre' },
      { id: 'platform', type: 'select', label: 'Platform', options: ['IG', 'FB'] },
    ]);
  });

  it('omits description marker for hidden', () => {
    expect(migrateFieldsToItems(fields, 'hidden')).toEqual([
      { id: 'title', type: 'text', label: 'Titre' },
      { id: 'platform', type: 'select', label: 'Platform', options: ['IG', 'FB'] },
    ]);
  });

  it('handles empty fields with after-fields position', () => {
    expect(migrateFieldsToItems([], 'after-fields')).toEqual([
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
    ]);
  });

  it('handles empty fields with hidden', () => {
    expect(migrateFieldsToItems([], 'hidden')).toEqual([]);
  });
});
