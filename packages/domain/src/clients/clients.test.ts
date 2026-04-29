import { describe, expect, it } from 'vitest';
import {
  CLIENT_COLOR_TOKENS,
  RACI_VALUES,
  computeInitials,
  isValidColorToken,
  isValidRaci,
  normalizeDomain,
  parseDomainList,
  raciLabelFr,
  raciTagVariant,
  validateClientName,
  validateContactName,
  validateInitials,
  canDeleteClient,
} from './index';

describe('CLIENT_COLOR_TOKENS', () => {
  it('exposes the 5 design tokens used across the UI', () => {
    expect(CLIENT_COLOR_TOKENS).toEqual(['c-acme', 'c-tech', 'c-nova', 'c-lumen', 'c-orbit']);
  });

  it('isValidColorToken accepts known tokens and rejects others', () => {
    expect(isValidColorToken('c-acme')).toBe(true);
    expect(isValidColorToken('c-orbit')).toBe(true);
    expect(isValidColorToken('c-bogus')).toBe(false);
    expect(isValidColorToken('')).toBe(false);
  });
});

describe('computeInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(computeInitials('Acme Brands')).toBe('AB');
    expect(computeInitials('Tech Corp')).toBe('TC');
    expect(computeInitials('Nova Studio Ltd')).toBe('NS');
  });

  it('falls back to the first 2 letters when only one word is provided', () => {
    expect(computeInitials('Lumen')).toBe('LU');
    expect(computeInitials('AB')).toBe('AB');
    expect(computeInitials('a')).toBe('A');
  });

  it('strips diacritics and ignores empty whitespace runs', () => {
    expect(computeInitials('Élégance Béton')).toBe('EB');
    expect(computeInitials('  acme   brands  ')).toBe('AB');
  });

  it('returns an empty string when the input has no letters', () => {
    expect(computeInitials('')).toBe('');
    expect(computeInitials('   ')).toBe('');
    expect(computeInitials('—')).toBe('');
  });
});

describe('validateClientName', () => {
  it('accepts names of 1-80 chars after trim', () => {
    expect(validateClientName('Acme')).toEqual({ ok: true, value: 'Acme' });
    expect(validateClientName('  Acme Brands  ')).toEqual({ ok: true, value: 'Acme Brands' });
  });

  it('rejects empty strings and overly long names', () => {
    expect(validateClientName('')).toEqual({ ok: false, code: 'EMPTY' });
    expect(validateClientName('   ')).toEqual({ ok: false, code: 'EMPTY' });
    expect(validateClientName('a'.repeat(81))).toEqual({ ok: false, code: 'TOO_LONG' });
  });
});

describe('validateInitials', () => {
  it('accepts 1-4 letters/digits, uppercased', () => {
    expect(validateInitials('AB')).toEqual({ ok: true, value: 'AB' });
    expect(validateInitials('a1')).toEqual({ ok: true, value: 'A1' });
    expect(validateInitials('Tech')).toEqual({ ok: true, value: 'TECH' });
  });

  it('rejects empty, too long, or non-alphanumeric input', () => {
    expect(validateInitials('')).toEqual({ ok: false, code: 'EMPTY' });
    expect(validateInitials('ABCDE')).toEqual({ ok: false, code: 'TOO_LONG' });
    expect(validateInitials('A B')).toEqual({ ok: false, code: 'INVALID_CHARS' });
    expect(validateInitials('A!')).toEqual({ ok: false, code: 'INVALID_CHARS' });
  });
});

describe('validateContactName', () => {
  it('rejects empty parts and trims surrounding whitespace', () => {
    expect(validateContactName({ firstName: 'Anna', lastName: 'Lambert' })).toEqual({
      ok: true,
      value: { firstName: 'Anna', lastName: 'Lambert' },
    });
    expect(validateContactName({ firstName: '  Anna ', lastName: ' Lambert ' })).toEqual({
      ok: true,
      value: { firstName: 'Anna', lastName: 'Lambert' },
    });
    expect(validateContactName({ firstName: '', lastName: 'X' })).toEqual({
      ok: false,
      code: 'FIRST_NAME_EMPTY',
    });
    expect(validateContactName({ firstName: 'X', lastName: '' })).toEqual({
      ok: false,
      code: 'LAST_NAME_EMPTY',
    });
  });
});

describe('domain helpers', () => {
  it('normalizeDomain lowercases and strips a leading @ or scheme', () => {
    expect(normalizeDomain('Acme.com')).toBe('acme.com');
    expect(normalizeDomain('@acme.com')).toBe('acme.com');
    expect(normalizeDomain('https://acme.com')).toBe('acme.com');
    expect(normalizeDomain('  acme.com  ')).toBe('acme.com');
  });

  it('parseDomainList splits by comma/space, dedupes, validates RFC-1035 shape', () => {
    expect(parseDomainList('acme.com, sub.acme.com')).toEqual({
      ok: true,
      value: ['acme.com', 'sub.acme.com'],
    });
    expect(parseDomainList('acme.com  Acme.com')).toEqual({
      ok: true,
      value: ['acme.com'],
    });
    expect(parseDomainList('')).toEqual({ ok: true, value: [] });
    expect(parseDomainList('not_a_domain')).toEqual({ ok: false, code: 'INVALID_DOMAIN' });
    // 64-char label = invalid (max is 63 per RFC 1035)
    expect(parseDomainList(`${'a'.repeat(64)}.com`)).toEqual({
      ok: false,
      code: 'INVALID_DOMAIN',
    });
  });
});

describe('RACI helpers', () => {
  it('exposes the 4 enum values in canonical order', () => {
    expect(RACI_VALUES).toEqual(['responsible', 'approver', 'consulted', 'informed']);
  });

  it('isValidRaci accepts the 4 values', () => {
    expect(isValidRaci('responsible')).toBe(true);
    expect(isValidRaci('informed')).toBe(true);
    expect(isValidRaci('foo')).toBe(false);
    expect(isValidRaci('')).toBe(false);
  });

  it('raciLabelFr returns short single-letter badge text', () => {
    expect(raciLabelFr('responsible')).toBe('R');
    expect(raciLabelFr('approver')).toBe('A');
    expect(raciLabelFr('consulted')).toBe('C');
    expect(raciLabelFr('informed')).toBe('I');
  });

  it('raciTagVariant maps to the design system Tag variants from PRD §6.6', () => {
    expect(raciTagVariant('responsible')).toBe('info'); // bleu
    expect(raciTagVariant('approver')).toBe('warning'); // ambre
    expect(raciTagVariant('consulted')).toBe('success'); // vert
    expect(raciTagVariant('informed')).toBe('neutral'); // gris
  });
});

describe('canDeleteClient (PRD §10 #14)', () => {
  it('allows deletion when no active projects exist', () => {
    expect(canDeleteClient({ activeProjectsCount: 0 })).toEqual({ ok: true });
  });

  it('refuses deletion and reports the count when active projects exist', () => {
    expect(canDeleteClient({ activeProjectsCount: 3 })).toEqual({
      ok: false,
      code: 'HAS_ACTIVE_PROJECTS',
      activeProjectsCount: 3,
    });
  });
});
