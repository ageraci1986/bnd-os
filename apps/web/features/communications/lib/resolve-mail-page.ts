/**
 * Deep-link helper (Plan 5c Task 2): given how many mails rank strictly
 * ahead of a target mail in the listing order, derive the 1-based page that
 * contains it. Pure — the caller is responsible for computing `newerCount`
 * with the exact same `where`/`orderBy` as the paginated listing query.
 */
export function resolveMailPage(input: {
  readonly newerCount: number;
  readonly pageSize: number;
}): number {
  return Math.floor(input.newerCount / input.pageSize) + 1;
}
