import { describe, expect, it } from 'vitest';
import {
  ALL_CLIENTS,
  clearClient,
  fromQueryParam,
  isFilteredBy,
  selectClient,
  toQueryParam,
} from './index';

describe('ALL_CLIENTS', () => {
  it('is the default "all" filter', () => {
    expect(ALL_CLIENTS).toEqual({ mode: 'all' });
  });

  it('is frozen (immutability)', () => {
    expect(Object.isFrozen(ALL_CLIENTS)).toBe(true);
  });
});

describe('selectClient', () => {
  it('returns a single-mode filter with the given clientId', () => {
    expect(selectClient('abc-123')).toEqual({ mode: 'single', clientId: 'abc-123' });
  });

  it('throws on empty clientId', () => {
    expect(() => selectClient('')).toThrow(/required/);
  });
});

describe('clearClient', () => {
  it('returns the all-clients filter', () => {
    expect(clearClient()).toEqual({ mode: 'all' });
  });
});

describe('isFilteredBy', () => {
  it('returns false when filter is "all"', () => {
    expect(isFilteredBy(ALL_CLIENTS, 'abc')).toBe(false);
  });

  it('returns true when filter matches', () => {
    expect(isFilteredBy(selectClient('abc'), 'abc')).toBe(true);
  });

  it('returns false when filter is single but on a different client', () => {
    expect(isFilteredBy(selectClient('abc'), 'xyz')).toBe(false);
  });
});

describe('toQueryParam', () => {
  it('returns null for the all filter (no URL param)', () => {
    expect(toQueryParam(ALL_CLIENTS)).toBeNull();
  });

  it('returns the clientId for a single filter', () => {
    expect(toQueryParam(selectClient('acme'))).toBe('acme');
  });
});

describe('fromQueryParam', () => {
  it('returns ALL_CLIENTS for null', () => {
    expect(fromQueryParam(null)).toEqual({ mode: 'all' });
  });

  it('returns ALL_CLIENTS for undefined', () => {
    expect(fromQueryParam(undefined)).toEqual({ mode: 'all' });
  });

  it('returns ALL_CLIENTS for empty string', () => {
    expect(fromQueryParam('')).toEqual({ mode: 'all' });
  });

  it('returns a single-mode filter for a non-empty value', () => {
    expect(fromQueryParam('acme')).toEqual({ mode: 'single', clientId: 'acme' });
  });

  it('round-trips through toQueryParam', () => {
    const f = selectClient('tech');
    expect(fromQueryParam(toQueryParam(f))).toEqual(f);
  });
});
