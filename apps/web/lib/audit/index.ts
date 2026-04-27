/**
 * Audit log helper (CLAUDE.md §4.7).
 *
 * Append-only events for security-relevant actions. RLS forbids INSERT from
 * the `authenticated` role, so we use the service-role Supabase client here
 * (or Prisma — same DB, runs as `postgres` which bypasses RLS).
 *
 * SECURITY:
 *  - `data` MUST be PII-safe. Never log raw email content, OAuth tokens,
 *    full IPs (truncate /24 for v4 if you need geo), passwords, JWTs.
 *  - The function is fail-safe: a logging failure never blocks the originating
 *    action. Errors are emitted to console for ops to triage.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import type { AuditAction, Prisma } from '@nexushub/db';

export interface AuditEntry {
  readonly action: AuditAction;
  readonly workspaceId?: string | null;
  readonly actorId?: string | null;
  readonly subjectType?: string | null;
  readonly subjectId?: string | null;
  /** PII-safe metadata only. */
  readonly data?: Prisma.InputJsonValue;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        workspaceId: entry.workspaceId ?? null,
        actorId: entry.actorId ?? null,
        subjectType: entry.subjectType ?? null,
        subjectId: entry.subjectId ?? null,
        data: entry.data ?? {},
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to record entry', {
      action: entry.action,
      workspaceId: entry.workspaceId,
      err: err instanceof Error ? err.message : 'unknown',
    });
  }
}
