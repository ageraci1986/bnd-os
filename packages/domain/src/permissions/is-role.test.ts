import { describe, expect, it } from 'vitest';
import { isRole } from './is-role';

describe('isRole', () => {
  it('accepts the three valid role strings', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('user')).toBe(true);
    expect(isRole('viewer')).toBe(true);
  });
  it('rejects legacy or unknown values', () => {
    expect(isRole('member')).toBe(false);
    expect(isRole('owner')).toBe(false);
    expect(isRole('')).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
    expect(isRole({})).toBe(false);
  });
});
