import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CARD_TEMPLATE_NAME,
  defaultCardTemplateItems,
  validateCardTemplateItems,
} from './index';

describe('default card template', () => {
  it('is named Standard', () => {
    expect(DEFAULT_CARD_TEMPLATE_NAME).toBe('Standard');
  });

  it('contains a description item followed by an empty checklist', () => {
    const items = defaultCardTemplateItems();
    expect(items).toEqual([
      { id: 'description', type: 'description' },
      { id: 'checklist', type: 'checklist', items: [] },
    ]);
  });

  it('round-trips through validateCardTemplateItems (same shape stored in DB)', () => {
    expect(validateCardTemplateItems(defaultCardTemplateItems())).toEqual(
      defaultCardTemplateItems(),
    );
  });
});
