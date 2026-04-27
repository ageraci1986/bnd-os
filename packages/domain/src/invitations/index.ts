/**
 * Invitation lifecycle (CLAUDE.md §4.3, ADR 0001 #1).
 *
 * Pure domain rules, used by Server Actions.
 *
 * Invariants:
 *  - TTL is 72h from creation (decision ADR 0001 #1).
 *  - A token is single-use: once `consumed_at` is set, it cannot be re-accepted.
 *  - The clear token never lives in the DB. Only its sha256 hash does.
 *  - Status is computed from timestamps to keep the DB the source of truth.
 */

export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000; // 72h

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface InvitationRow {
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export type InvitationCheckOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'expired' | 'consumed' | 'revoked' };

export function checkInvitationUsable(inv: InvitationRow, now: Date): InvitationCheckOutcome {
  if (inv.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (inv.consumedAt !== null || inv.status === 'accepted') {
    return { ok: false, reason: 'consumed' };
  }
  if (inv.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

export function computeInvitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS);
}
