import { describe, expect, it, vi } from 'vitest';

vi.mock('@nexushub/db', () => ({}));

import {
  EMPTY_PROJECT_CARD_FILTER,
  activeFilterCount,
  buildCardFilterClauses,
  parseProjectCardFilter,
  writeProjectCardFilter,
} from './card-filter';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('mine param', () => {
  it('parses mine=1 and ignores other values', () => {
    expect(parseProjectCardFilter({ mine: '1' }).mine).toBe(true);
    expect(parseProjectCardFilter({ mine: 'true' }).mine).toBe(false);
    expect(parseProjectCardFilter({}).mine).toBe(false);
  });

  it('writes and clears mine while preserving unrelated params', () => {
    const on = writeProjectCardFilter(new URLSearchParams('client=acme'), {
      ...EMPTY_PROJECT_CARD_FILTER,
      mine: true,
    });
    expect(on.get('mine')).toBe('1');
    expect(on.get('client')).toBe('acme');
    const off = writeProjectCardFilter(on, EMPTY_PROJECT_CARD_FILTER);
    expect(off.has('mine')).toBe(false);
  });

  it('is not counted in the Filtres badge (the toggle shows its own state)', () => {
    expect(activeFilterCount({ ...EMPTY_PROJECT_CARD_FILTER, mine: true })).toBe(0);
  });
});

describe('buildCardFilterClauses with mine', () => {
  it('scopes to the session user, never a URL value', () => {
    const where = buildCardFilterClauses({ ...EMPTY_PROJECT_CARD_FILTER, mine: true }, ME);
    expect(where).toEqual({ assignees: { some: { userId: ME } } });
  });

  it('ANDs mine with an explicit assignee filter', () => {
    const where = buildCardFilterClauses(
      { ...EMPTY_PROJECT_CARD_FILTER, mine: true, assigneeIds: [OTHER] },
      ME,
    );
    expect(where).toEqual({
      AND: [
        { assignees: { some: { userId: { in: [OTHER] } } } },
        { assignees: { some: { userId: ME } } },
      ],
    });
  });

  it('adds nothing when mine is off', () => {
    expect(buildCardFilterClauses(EMPTY_PROJECT_CARD_FILTER, ME)).toEqual({});
  });
});
