import { describe, expect, it } from 'vitest';
import { matchClientByDomain, buildDomainIndex } from './auto-associate';

describe('buildDomainIndex', () => {
  it('lowercases and groups by domain, preserving insertion order', () => {
    const idx = buildDomainIndex([
      { id: 'A', emailDomains: ['Acme.com'] },
      { id: 'B', emailDomains: ['acme.com', 'other.io'] },
    ]);
    expect(idx.get('acme.com')).toEqual(['A', 'B']);
    expect(idx.get('other.io')).toEqual(['B']);
  });
});

describe('matchClientByDomain', () => {
  const idx = buildDomainIndex([
    { id: 'A', emailDomains: ['acme.com'] },
    { id: 'B', emailDomains: ['acme.com', 'sub.io'] },
  ]);

  it('matches a known domain (first deterministic)', () => {
    expect(matchClientByDomain('marie@acme.com', idx)).toBe('A');
  });

  it('is case-insensitive', () => {
    expect(matchClientByDomain('Marie@ACME.COM', idx)).toBe('A');
  });

  it('returns null on unmatched domain', () => {
    expect(matchClientByDomain('a@nope.io', idx)).toBeNull();
  });

  it('does not match subdomains', () => {
    expect(matchClientByDomain('a@dev.acme.com', idx)).toBeNull();
  });

  it('returns null on malformed email', () => {
    expect(matchClientByDomain('not-an-email', idx)).toBeNull();
    expect(matchClientByDomain('', idx)).toBeNull();
  });
});
