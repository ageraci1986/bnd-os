import { describe, expect, it } from 'vitest';
import {
  INVITATION_TTL_MS,
  checkInvitationUsable,
  computeInvitationExpiry,
  type InvitationRow,
} from './index.js';

const now = new Date('2026-04-27T12:00:00Z');
const future = new Date(now.getTime() + 60_000);

const base: InvitationRow = {
  status: 'pending',
  expiresAt: future,
  consumedAt: null,
};

describe('INVITATION_TTL_MS', () => {
  it('is exactly 72 hours (ADR 0001 #1)', () => {
    expect(INVITATION_TTL_MS).toBe(72 * 60 * 60 * 1000);
  });
});

describe('computeInvitationExpiry', () => {
  it('returns now + 72h', () => {
    const exp = computeInvitationExpiry(now);
    expect(exp.getTime() - now.getTime()).toBe(INVITATION_TTL_MS);
  });
});

describe('checkInvitationUsable', () => {
  it('accepts a fresh pending invitation', () => {
    expect(checkInvitationUsable(base, now)).toEqual({ ok: true });
  });

  it('rejects a revoked invitation', () => {
    expect(checkInvitationUsable({ ...base, status: 'revoked' }, now)).toEqual({
      ok: false,
      reason: 'revoked',
    });
  });

  it('rejects an already-consumed invitation', () => {
    expect(
      checkInvitationUsable(
        { ...base, status: 'accepted', consumedAt: new Date('2026-04-26T10:00:00Z') },
        now,
      ),
    ).toEqual({ ok: false, reason: 'consumed' });
  });

  it('rejects when consumedAt is set even if status is pending (race-safety)', () => {
    expect(
      checkInvitationUsable({ ...base, consumedAt: new Date('2026-04-27T11:59:59Z') }, now),
    ).toEqual({ ok: false, reason: 'consumed' });
  });

  it('rejects an expired invitation (expiresAt = now)', () => {
    expect(checkInvitationUsable({ ...base, expiresAt: now }, now)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects an expired invitation (expiresAt < now)', () => {
    const past = new Date(now.getTime() - 1);
    expect(checkInvitationUsable({ ...base, expiresAt: past }, now)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('prefers revoked > consumed > expired (security ordering)', () => {
    const past = new Date(now.getTime() - 1);
    // Revoked + expired + consumed → should report revoked (most explicit).
    expect(
      checkInvitationUsable({ status: 'revoked', expiresAt: past, consumedAt: past }, now),
    ).toEqual({ ok: false, reason: 'revoked' });
  });
});
