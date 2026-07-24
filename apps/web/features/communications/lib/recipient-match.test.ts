import { describe, it, expect } from 'vitest';
import {
  matchesQuery,
  scoreRow,
  dedupeByEmail,
  isValidEmail,
  RACI_BONUS,
  type RankableRow,
} from './recipient-match';

describe('matchesQuery', () => {
  it('matches substring in email, case-insensitive', () => {
    expect(matchesQuery('BE', 'be.collections@bnp.fr', null)).toBe(true);
    expect(matchesQuery('bnp', 'be.collections@bnp.fr', null)).toBe(true);
    expect(matchesQuery('xyz', 'be.collections@bnp.fr', null)).toBe(false);
  });

  it('matches substring in name, case-insensitive', () => {
    expect(matchesQuery('ELENA', 'e@x.fr', 'Elena Rossi')).toBe(true);
    expect(matchesQuery('rossi', 'e@x.fr', 'Elena Rossi')).toBe(true);
  });

  it('is accent-insensitive on both sides', () => {
    expect(matchesQuery('elena', 'e@x.fr', 'Éléna Rossi')).toBe(true);
    expect(matchesQuery('éléna', 'e@x.fr', 'Elena Rossi')).toBe(true);
    expect(matchesQuery('boëdec', 'boedec@x.fr', null)).toBe(true);
  });

  it('handles null name', () => {
    expect(matchesQuery('foo', 'foo@bar.fr', null)).toBe(true);
    expect(matchesQuery('bar', 'foo@bar.fr', null)).toBe(true);
    expect(matchesQuery('baz', 'foo@bar.fr', null)).toBe(false);
  });
});

describe('scoreRow', () => {
  const NOW = new Date('2026-07-24T12:00:00Z').getTime();
  const dayAgo = new Date(NOW - 86_400_000).toISOString();
  const monthAgo = new Date(NOW - 30 * 86_400_000).toISOString();

  it('rewards higher hit counts (dampened log)', () => {
    const low: RankableRow = { hits: 1, lastSeenAt: dayAgo, source: 'mail' };
    const high: RankableRow = { hits: 100, lastSeenAt: dayAgo, source: 'mail' };
    expect(scoreRow(high, NOW)).toBeGreaterThan(scoreRow(low, NOW));
  });

  it('rewards recency (exp-decay ~3 week half-life)', () => {
    const recent: RankableRow = { hits: 5, lastSeenAt: dayAgo, source: 'mail' };
    const old: RankableRow = { hits: 5, lastSeenAt: monthAgo, source: 'mail' };
    expect(scoreRow(recent, NOW)).toBeGreaterThan(scoreRow(old, NOW));
  });

  it('adds a fixed bonus for contact source', () => {
    const mail: RankableRow = { hits: 5, lastSeenAt: dayAgo, source: 'mail' };
    const contact: RankableRow = { hits: 5, lastSeenAt: dayAgo, source: 'contact' };
    expect(scoreRow(contact, NOW) - scoreRow(mail, NOW)).toBeCloseTo(RACI_BONUS, 5);
  });
});

describe('dedupeByEmail', () => {
  it('merges rows with the same email (case-insensitive), summing hits and preferring the contact name', () => {
    const mailRow = {
      email: 'Elena@X.fr',
      name: 'e rossi (informal)',
      source: 'mail' as const,
      hits: 3,
      lastSeenAt: '2026-07-01T00:00:00.000Z',
      jobTitle: null,
      clientName: null,
      raci: null,
    };
    const contactRow = {
      email: 'elena@x.fr',
      name: 'Elena Rossi',
      source: 'contact' as const,
      hits: 0,
      lastSeenAt: '2026-07-24T00:00:00.000Z',
      jobTitle: 'CMO',
      clientName: 'Belgo',
      raci: 'R' as const,
    };
    const out = dedupeByEmail([mailRow, contactRow]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      email: 'Elena@X.fr',
      name: 'Elena Rossi', // contact name wins
      source: 'contact', // marker if any source was contact
      hits: 3, // sum
      lastSeenAt: '2026-07-24T00:00:00.000Z', // latest
      jobTitle: 'CMO',
      clientName: 'Belgo',
      raci: 'R',
    });
  });

  it('preserves distinct emails', () => {
    const rows = [
      {
        email: 'a@x.fr',
        name: 'A',
        source: 'mail' as const,
        hits: 1,
        lastSeenAt: '2026-07-01T00:00:00.000Z',
        jobTitle: null,
        clientName: null,
        raci: null,
      },
      {
        email: 'b@x.fr',
        name: 'B',
        source: 'mail' as const,
        hits: 1,
        lastSeenAt: '2026-07-01T00:00:00.000Z',
        jobTitle: null,
        clientName: null,
        raci: null,
      },
    ];
    expect(dedupeByEmail(rows)).toHaveLength(2);
  });
});

describe('isValidEmail', () => {
  it.each([
    ['a@b.fr', true],
    ['foo.bar+baz@example.co.uk', true],
    ['plainstring', false],
    ['no@dot', false],
    ['@nolocal.fr', false],
    ['spaces here@x.fr', false],
    ['', false],
  ])('%s → %s', (input, expected) => {
    expect(isValidEmail(input)).toBe(expected);
  });
});
