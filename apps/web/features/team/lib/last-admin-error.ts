/**
 * Sentinel raised by the PL/pgSQL trigger `protect_last_admin`
 * (migration 20260427100007): `RAISE EXCEPTION 'LAST_ADMIN_PROTECTED: …'`.
 * The trigger enforces "≥ 1 admin per workspace" at the DB layer; callers
 * detect it here and surface a friendly message instead of a 500.
 */
export const LAST_ADMIN_PROTECTED_SENTINEL = 'LAST_ADMIN_PROTECTED';

/**
 * Detect by message string: Turbopack's RSC module boundary loads Prisma
 * twice so `instanceof Prisma.PrismaClientKnownRequestError` is unreliable,
 * and PG raise-exception errors actually surface as
 * PrismaClientUnknownRequestError, which would never match anyway.
 *
 * Shared by `team-core.ts` and the form actions `change-member-role.ts` /
 * `remove-member.ts` so the detection can never drift between the
 * assistant-tool path and the browser path.
 */
export function isLastAdminProtectedError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(LAST_ADMIN_PROTECTED_SENTINEL);
}
