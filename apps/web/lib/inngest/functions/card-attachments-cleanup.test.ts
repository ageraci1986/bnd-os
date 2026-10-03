import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_TTL_MS,
  cardAttachmentsCleanup,
  runCardAttachmentsCleanup,
  staleAttachmentsWhere,
  type CleanupDeps,
  type StaleAttachment,
} from './card-attachments-cleanup';

const NOW = new Date('2026-10-03T12:00:00Z');

function stale(id: string, scanStatus: StaleAttachment['scanStatus'] = 'pending'): StaleAttachment {
  return { id, storagePath: `ws/card/${id}`, scanStatus };
}

function deps(overrides: Partial<CleanupDeps> = {}): CleanupDeps {
  return {
    now: () => NOW,
    findStale: vi.fn(async () => [stale('a'), stale('b', 'dirty')]),
    deleteRow: vi.fn(async () => true),
    remove: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('staleAttachmentsWhere', () => {
  it('keeps pending rows longer than the 2 h signed-upload token validity (storage-js)', () => {
    // Un jeton d'upload signé reste utilisable 2 h : supprimer la ligne avant
    // laisserait un objet orphelin uploadé après le nettoyage.
    expect(PENDING_TTL_MS).toBeGreaterThan(2 * 60 * 60 * 1000);
  });

  it('targets pending rows older than 2h15 and rejected rows older than 7 days', () => {
    expect(staleAttachmentsWhere(NOW)).toEqual({
      OR: [
        { scanStatus: 'pending', createdAt: { lt: new Date('2026-10-03T09:45:00Z') } },
        {
          scanStatus: { in: ['dirty', 'scan_failed'] },
          updatedAt: { lt: new Date('2026-09-26T12:00:00Z') },
        },
      ],
    });
  });
});

describe('runCardAttachmentsCleanup', () => {
  it('deletes every stale row and removes its Storage object', async () => {
    const d = deps();
    const res = await runCardAttachmentsCleanup(d);
    expect(d.findStale).toHaveBeenCalledWith(NOW);
    expect(d.deleteRow).toHaveBeenCalledWith(stale('a'));
    expect(d.deleteRow).toHaveBeenCalledWith(stale('b', 'dirty'));
    expect(d.remove).toHaveBeenCalledWith('ws/card/a');
    expect(d.remove).toHaveBeenCalledWith('ws/card/b');
    expect(res).toEqual({ found: 2, deleted: 2, failed: 0 });
  });

  it('keeps the object when the row changed status in between (conditional delete no-op)', async () => {
    const d = deps({
      findStale: vi.fn(async () => [stale('a')]),
      deleteRow: vi.fn(async () => false),
    });
    const res = await runCardAttachmentsCleanup(d);
    expect(d.remove).not.toHaveBeenCalled();
    expect(res).toEqual({ found: 1, deleted: 0, failed: 0 });
  });

  it('isolates failures: an error on one row does not stop the next', async () => {
    const deleteRow = vi.fn(async (r: StaleAttachment) => {
      if (r.id === 'a') throw new Error('db down');
      return true;
    });
    const d = deps({ deleteRow });
    const res = await runCardAttachmentsCleanup(d);
    expect(deleteRow).toHaveBeenCalledTimes(2);
    expect(d.remove).toHaveBeenCalledTimes(1);
    expect(d.remove).toHaveBeenCalledWith('ws/card/b');
    expect(res).toEqual({ found: 2, deleted: 1, failed: 1 });
  });
});

describe('cardAttachmentsCleanup (Inngest wiring — pinned)', () => {
  it('runs hourly at minute 15', () => {
    expect(cardAttachmentsCleanup.id()).toBe('card-attachments-cleanup');
    expect(cardAttachmentsCleanup.opts.triggers).toEqual([{ cron: '15 * * * *' }]);
  });
});
