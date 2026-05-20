import { describe, expect, it } from 'vitest';
import { isDueDateOverdue, startOfTodayInParis } from './index';

// Paris is UTC+2 in summer (CEST), UTC+1 in winter (CET).

describe('isDueDateOverdue', () => {
  it('is false when due date is later today (Paris)', () => {
    const due = new Date('2026-05-20T00:00:00.000Z');
    const now = new Date('2026-05-20T07:00:00.000Z'); // 09:00 Paris, same day
    expect(isDueDateOverdue(due, now)).toBe(false);
  });

  it('is false at 23:00 Paris on the due day', () => {
    const due = new Date('2026-05-20T00:00:00.000Z');
    const now = new Date('2026-05-20T21:00:00.000Z'); // 23:00 Paris
    expect(isDueDateOverdue(due, now)).toBe(false);
  });

  it('is true once Paris rolls over to the next day', () => {
    const due = new Date('2026-05-20T00:00:00.000Z');
    const now = new Date('2026-05-20T22:30:00.000Z'); // 00:30 Paris next day
    expect(isDueDateOverdue(due, now)).toBe(true);
  });

  it('is true when due date is clearly in the past', () => {
    const due = new Date('2026-05-18T00:00:00.000Z');
    const now = new Date('2026-05-20T07:00:00.000Z');
    expect(isDueDateOverdue(due, now)).toBe(true);
  });

  it('is false when due date is in the future', () => {
    const due = new Date('2026-05-25T00:00:00.000Z');
    const now = new Date('2026-05-20T07:00:00.000Z');
    expect(isDueDateOverdue(due, now)).toBe(false);
  });

  it('handles winter (CET, UTC+1) rollover', () => {
    const due = new Date('2026-01-15T00:00:00.000Z');
    const now = new Date('2026-01-15T23:30:00.000Z'); // 00:30 Paris next day
    expect(isDueDateOverdue(due, now)).toBe(true);
    const now2 = new Date('2026-01-15T22:30:00.000Z'); // 23:30 Paris same day
    expect(isDueDateOverdue(due, now2)).toBe(false);
  });
});

describe('startOfTodayInParis', () => {
  it('returns the UTC instant of Paris local midnight (summer, UTC+2)', () => {
    const now = new Date('2026-05-20T08:00:00.000Z'); // 10:00 Paris
    expect(startOfTodayInParis(now).toISOString()).toBe('2026-05-19T22:00:00.000Z');
  });

  it('returns the UTC instant of Paris local midnight (winter, UTC+1)', () => {
    const now = new Date('2026-01-20T08:00:00.000Z'); // 09:00 Paris
    expect(startOfTodayInParis(now).toISOString()).toBe('2026-01-19T23:00:00.000Z');
  });
});
