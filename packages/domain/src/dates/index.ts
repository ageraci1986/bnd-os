/**
 * Timezone-aware deadline helpers. Pure — no Node/Next/Prisma deps.
 *
 * Deadlines are date-only ("a day"), entered via a date input and stored at
 * UTC midnight. The product rule (decided 2026-05-20) treats a deadline as
 * end-of-day in Europe/Paris: a card due 20/5 is only overdue from 21/5
 * 00:00 Paris. We compare calendar days in Paris rather than instants, which
 * is DST-safe and needs no offset arithmetic.
 */

export const DUE_TIME_ZONE = 'Europe/Paris';

/** "YYYY-MM-DD" calendar day of `d` in the given IANA timezone. */
function calendarDayInTz(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * True when `now`'s calendar day (Paris) is strictly after the due date's
 * calendar day (Paris) — i.e. the deadline's day has fully elapsed.
 */
export function isDueDateOverdue(
  dueDate: Date,
  now: Date,
  timeZone: string = DUE_TIME_ZONE,
): boolean {
  return calendarDayInTz(now, timeZone) > calendarDayInTz(dueDate, timeZone);
}

/**
 * The UTC instant corresponding to *today's* local midnight in Paris.
 * Used by the "overdue" card filter to build a `dueDate < X` clause that
 * matches the calendar-day semantics above.
 */
export function startOfTodayInParis(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DUE_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');

  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offsetMs = wallClockAsUtc - now.getTime();
  const parisMidnightWallClockAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'));
  return new Date(parisMidnightWallClockAsUtc - offsetMs);
}
