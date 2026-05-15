import { describe, expect, it } from 'vitest';
import { scopeFromRows, scopedClientWhere, scopedProjectWhere, scopedCardWhere } from './scope';

describe('scopeFromRows', () => {
  it('returns workspace scope when there are no rows', () => {
    expect(scopeFromRows([])).toEqual({ kind: 'workspace' });
  });
  it('returns restricted with the union of client + project ids', () => {
    expect(
      scopeFromRows([
        { clientId: 'c-1', projectId: null },
        { clientId: null, projectId: 'p-1' },
        { clientId: 'c-2', projectId: null },
      ]),
    ).toEqual({ kind: 'restricted', clientIds: ['c-1', 'c-2'], projectIds: ['p-1'] });
  });
});

describe('scopedClientWhere', () => {
  it('returns {} for workspace scope (no overhead)', () => {
    expect(scopedClientWhere({ kind: 'workspace' })).toEqual({});
  });
  it('returns id-in for restricted with at least one client', () => {
    expect(scopedClientWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: [] })).toEqual({
      id: { in: ['c-1'] },
    });
  });
  it('restricted with no clientIds (only projects) returns clients reachable through projects', () => {
    expect(scopedClientWhere({ kind: 'restricted', clientIds: [], projectIds: ['p-1'] })).toEqual({
      projects: { some: { id: { in: ['p-1'] } } },
    });
  });
  it('restricted with both returns the OR of the two predicates', () => {
    expect(
      scopedClientWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: ['p-1'] }),
    ).toEqual({
      OR: [{ id: { in: ['c-1'] } }, { projects: { some: { id: { in: ['p-1'] } } } }],
    });
  });
  it('restricted with zero rows returns id-in-empty (sees nothing)', () => {
    expect(scopedClientWhere({ kind: 'restricted', clientIds: [], projectIds: [] })).toEqual({
      id: { in: [] },
    });
  });
});

describe('scopedProjectWhere', () => {
  it('returns {} for workspace scope', () => {
    expect(scopedProjectWhere({ kind: 'workspace' })).toEqual({});
  });
  it('returns OR for restricted with both', () => {
    expect(
      scopedProjectWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: ['p-1'] }),
    ).toEqual({ OR: [{ id: { in: ['p-1'] } }, { clientId: { in: ['c-1'] } }] });
  });
  it('only projects', () => {
    expect(scopedProjectWhere({ kind: 'restricted', clientIds: [], projectIds: ['p-1'] })).toEqual({
      id: { in: ['p-1'] },
    });
  });
  it('only clients', () => {
    expect(scopedProjectWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: [] })).toEqual({
      clientId: { in: ['c-1'] },
    });
  });
  it('empty restricted returns id-in-empty', () => {
    expect(scopedProjectWhere({ kind: 'restricted', clientIds: [], projectIds: [] })).toEqual({
      id: { in: [] },
    });
  });
});

describe('scopedCardWhere', () => {
  it('returns {} for workspace scope', () => {
    expect(scopedCardWhere({ kind: 'workspace' })).toEqual({});
  });
  it('filters cards through their project relation', () => {
    expect(
      scopedCardWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: ['p-1'] }),
    ).toEqual({
      project: { OR: [{ id: { in: ['p-1'] } }, { clientId: { in: ['c-1'] } }] },
    });
  });
});
