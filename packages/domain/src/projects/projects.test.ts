import { describe, expect, it } from 'vitest';
import {
  BLOCKED_COLUMN_NAME,
  BLOCKED_COLUMN_POSITION,
  BUILTIN_PROJECT_TYPES,
  BUILTIN_TEMPLATES,
  buildProjectColumns,
  computeCardPosition,
  findTemplate,
  validateProjectDates,
  validateProjectName,
} from './index';

describe('validateProjectName', () => {
  it('accepts trimmed names of 1-120 chars', () => {
    expect(validateProjectName('Été 2026 — Acme')).toEqual({ ok: true, value: 'Été 2026 — Acme' });
    expect(validateProjectName('  Été  ')).toEqual({ ok: true, value: 'Été' });
  });

  it('rejects empty + too-long names', () => {
    expect(validateProjectName('')).toEqual({ ok: false, code: 'EMPTY' });
    expect(validateProjectName('   ')).toEqual({ ok: false, code: 'EMPTY' });
    expect(validateProjectName('x'.repeat(121))).toEqual({ ok: false, code: 'TOO_LONG' });
  });
});

describe('validateProjectDates', () => {
  it('accepts both null', () => {
    expect(validateProjectDates({ startDate: null, endDate: null })).toEqual({
      ok: true,
      startDate: null,
      endDate: null,
    });
  });

  it('accepts only one set', () => {
    const start = new Date('2026-05-01');
    expect(validateProjectDates({ startDate: start, endDate: null })).toEqual({
      ok: true,
      startDate: start,
      endDate: null,
    });
  });

  it('rejects when end < start', () => {
    const start = new Date('2026-06-01');
    const end = new Date('2026-05-01');
    expect(validateProjectDates({ startDate: start, endDate: end })).toEqual({
      ok: false,
      code: 'END_BEFORE_START',
    });
  });

  it('accepts equal dates (single-day project)', () => {
    const d = new Date('2026-05-01');
    expect(validateProjectDates({ startDate: d, endDate: d })).toEqual({
      ok: true,
      startDate: d,
      endDate: d,
    });
  });
});

describe('built-in project types', () => {
  it('exposes the 5 canonical types from the mockup', () => {
    expect(BUILTIN_PROJECT_TYPES.map((t) => t.id)).toEqual([
      'campagne',
      'ongoing',
      'lancement',
      'spotTV',
      'socialMedia',
    ]);
  });
});

describe('built-in Kanban templates', () => {
  it('exposes 5 templates including "empty"', () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual([
      'creative',
      'video',
      'social',
      'standard',
      'empty',
    ]);
  });

  it('only "creative" is marked as recommended', () => {
    const recommended = BUILTIN_TEMPLATES.filter((t) => t.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0]?.id).toBe('creative');
  });

  it('findTemplate returns undefined for unknown ids', () => {
    expect(findTemplate('does-not-exist')).toBeUndefined();
    expect(findTemplate('creative')?.name).toBe('Campagne créa');
  });
});

describe('buildProjectColumns', () => {
  it('returns user columns + a system Bloqué column at the end', () => {
    const tpl = findTemplate('standard')!;
    const cols = buildProjectColumns(tpl);

    expect(cols).toHaveLength(5); // 4 + Bloqué
    expect(cols.slice(0, 4).map((c) => c.name)).toEqual([
      'À faire',
      'En cours',
      'Validation',
      'Done',
    ]);
    expect(cols[4]).toEqual({
      name: BLOCKED_COLUMN_NAME,
      position: BLOCKED_COLUMN_POSITION,
      isBlockedSystem: true,
    });
  });

  it('uses sparse 1024-step positions on user columns', () => {
    const tpl = findTemplate('standard')!;
    const cols = buildProjectColumns(tpl);
    expect(cols.slice(0, 4).map((c) => c.position)).toEqual([1024, 2048, 3072, 4096]);
  });

  it('the empty template still emits a system Bloqué column', () => {
    const tpl = findTemplate('empty')!;
    const cols = buildProjectColumns(tpl);
    expect(cols).toHaveLength(1);
    expect(cols[0]).toEqual({
      name: BLOCKED_COLUMN_NAME,
      position: BLOCKED_COLUMN_POSITION,
      isBlockedSystem: true,
    });
  });
});

describe('computeCardPosition', () => {
  it('returns 1024 when the column is empty', () => {
    expect(computeCardPosition({ orderedSiblingPositions: [], targetIndex: 0 })).toBe(1024);
  });

  it('inserts at the top by halving the first sibling', () => {
    expect(
      computeCardPosition({ orderedSiblingPositions: [2048, 3072, 4096], targetIndex: 0 }),
    ).toBe(1024);
  });

  it('inserts at the bottom by appending +1024', () => {
    expect(
      computeCardPosition({ orderedSiblingPositions: [1024, 2048, 3072], targetIndex: 3 }),
    ).toBe(4096);
  });

  it('inserts in the middle as the floor midpoint', () => {
    expect(
      computeCardPosition({ orderedSiblingPositions: [1024, 2048, 3072], targetIndex: 1 }),
    ).toBe(1536);
    expect(
      computeCardPosition({ orderedSiblingPositions: [1024, 2048, 3072], targetIndex: 2 }),
    ).toBe(2560);
  });

  it('handles a tight gap (positions adjacent — slot still computes)', () => {
    // before=10, after=11 → floor(21/2)=10 (collision!) — caller must rebalance
    // but the function itself shouldn't throw.
    expect(computeCardPosition({ orderedSiblingPositions: [10, 11], targetIndex: 1 })).toBe(10);
  });

  it('falls back to first-1024 when the only sibling is at position 1', () => {
    expect(computeCardPosition({ orderedSiblingPositions: [1], targetIndex: 0 })).toBe(-1023);
  });
});
