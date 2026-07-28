import { describe, expect, it, vi } from 'vitest';
import type { NewlyBlockedCard } from '@/features/projects/lib/reconcile';
import {
  blockedCardsScan,
  runBlockedCardsScan,
  type BlockedCardsScanDeps,
} from './blocked-cards-scan';

// `runStep` is a stand-in for Inngest's `step.run` — in production Inngest
// MEMOIZES each step's (serializable) result across retries; here it just
// awaits the callback directly so `runBlockedCardsScan`'s own control flow
// (two-phase scan/notify, per-workspace isolation) is what's under test.
function directRunStep<T>(_stepId: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}

function baseDeps(overrides: Partial<BlockedCardsScanDeps> = {}): BlockedCardsScanDeps {
  return {
    listWorkspaceIds: vi.fn(async () => ['ws-1']),
    reconcile: vi.fn(async () => ({ newlyBlocked: [] as readonly NewlyBlockedCard[] })),
    notify: vi.fn(async () => ({ notices: 0 })),
    runStep: directRunStep,
    now: () => new Date('2026-07-28T10:00:00Z'),
    ...overrides,
  };
}

describe('runBlockedCardsScan', () => {
  it('calls reconcile directly (not reconcileBeforeRead) for each workspace, passing `now`', async () => {
    const reconcile = vi.fn(async () => ({ newlyBlocked: [] as readonly NewlyBlockedCard[] }));
    const now = () => new Date('2026-07-28T10:00:00Z');
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-1', 'ws-2'],
      reconcile,
      now,
    });

    await runBlockedCardsScan(deps);

    expect(reconcile).toHaveBeenCalledWith('ws-1', { now: now() });
    expect(reconcile).toHaveBeenCalledWith('ws-2', { now: now() });
  });

  it('runs scan and notify as two SEPARATE steps per workspace (retry-safe semantics)', async () => {
    const card: NewlyBlockedCard = { cardId: 'card-1', title: 'Overdue', projectId: 'proj-1' };
    const runStep = vi.fn(directRunStep) as BlockedCardsScanDeps['runStep'];
    const deps = baseDeps({
      reconcile: async () => ({ newlyBlocked: [card] }),
      notify: async () => ({ notices: 1 }),
      runStep,
    });

    await runBlockedCardsScan(deps);

    expect(runStep).toHaveBeenCalledTimes(2);
    expect(runStep).toHaveBeenNthCalledWith(1, 'scan-ws-1', expect.any(Function));
    expect(runStep).toHaveBeenNthCalledWith(2, 'notify-ws-1', expect.any(Function));
  });

  it('feeds notify with the list RETURNED by the scan step — never a re-call of reconcile', async () => {
    const cards: NewlyBlockedCard[] = [
      { cardId: 'card-1', title: 'One', projectId: 'proj-1' },
      { cardId: 'card-2', title: 'Two', projectId: 'proj-2' },
    ];
    const reconcile = vi.fn(async () => ({ newlyBlocked: cards as readonly NewlyBlockedCard[] }));
    const notify = vi.fn(async () => ({ notices: 3 }));
    const deps = baseDeps({ reconcile, notify });

    const result = await runBlockedCardsScan(deps);

    // reconcile ran exactly once per workspace (a second run would return []
    // since the cards are already blocked) and its result IS what notify got.
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('ws-1', cards);
    expect(result).toEqual({ workspaces: 1, newlyBlocked: 2, notices: 3 });
  });

  it('skips the notify step entirely when the scan found nothing (no empty step in the run)', async () => {
    const runStep = vi.fn(directRunStep) as BlockedCardsScanDeps['runStep'];
    const notify = vi.fn(async () => ({ notices: 0 }));
    const deps = baseDeps({ runStep, notify });

    const result = await runBlockedCardsScan(deps);

    expect(runStep).toHaveBeenCalledTimes(1);
    expect(runStep).toHaveBeenCalledWith('scan-ws-1', expect.any(Function));
    expect(notify).not.toHaveBeenCalled();
    expect(result).toEqual({ workspaces: 1, newlyBlocked: 0, notices: 0 });
  });

  it('isolates failures per workspace: one workspace’s scan throwing does not block the others', async () => {
    const card: NewlyBlockedCard = { cardId: 'card-2', title: 'Card 2', projectId: 'proj-1' };
    const reconcile = vi.fn(async (workspaceId: string) => {
      if (workspaceId === 'ws-bad') throw new Error('db down');
      return { newlyBlocked: [card] as readonly NewlyBlockedCard[] };
    });
    const notify = vi.fn(async () => ({ notices: 1 }));
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-bad', 'ws-ok'],
      reconcile,
      notify,
    });

    const result = await runBlockedCardsScan(deps);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('ws-ok', [card]);
    expect(result).toEqual({ workspaces: 2, newlyBlocked: 1, notices: 1 });
  });

  it('isolates failures per workspace when the notify step throws too', async () => {
    const cardBad: NewlyBlockedCard = { cardId: 'card-3', title: 'Bad', projectId: 'proj-bad' };
    const cardOk: NewlyBlockedCard = { cardId: 'card-4', title: 'Ok', projectId: 'proj-ok' };
    const reconcile = vi.fn(async (workspaceId: string) =>
      workspaceId === 'ws-bad'
        ? { newlyBlocked: [cardBad] as readonly NewlyBlockedCard[] }
        : { newlyBlocked: [cardOk] as readonly NewlyBlockedCard[] },
    );
    const notify = vi.fn(async (workspaceId: string) => {
      if (workspaceId === 'ws-bad') throw new Error('boom');
      return { notices: 1 };
    });
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-bad', 'ws-ok'],
      reconcile,
      notify,
    });

    const result = await runBlockedCardsScan(deps);

    expect(notify).toHaveBeenCalledTimes(2);
    // ws-bad's scan still counted its newly-blocked card; only its notices
    // are lost in this in-process run (and in production Inngest would RETRY
    // that notify step with the memoized scan result — see module header).
    expect(result).toEqual({ workspaces: 2, newlyBlocked: 2, notices: 1 });
  });

  it('returns workspaces/newlyBlocked/notices counts across multiple workspaces', async () => {
    const cardA: NewlyBlockedCard = { cardId: 'card-a', title: 'A', projectId: 'proj-a' };
    const cardB: NewlyBlockedCard = { cardId: 'card-b', title: 'B', projectId: 'proj-b' };
    const reconcile = vi.fn(async (workspaceId: string) =>
      workspaceId === 'ws-1'
        ? { newlyBlocked: [cardA] as readonly NewlyBlockedCard[] }
        : { newlyBlocked: [cardB] as readonly NewlyBlockedCard[] },
    );
    const notify = vi.fn(async () => ({ notices: 1 }));
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-1', 'ws-2'],
      reconcile,
      notify,
    });

    const result = await runBlockedCardsScan(deps);

    expect(result).toEqual({ workspaces: 2, newlyBlocked: 2, notices: 2 });
  });

  it('returns zero counts and calls nothing else when there are no workspaces', async () => {
    const reconcile = vi.fn(async () => ({ newlyBlocked: [] as readonly NewlyBlockedCard[] }));
    const deps = baseDeps({ listWorkspaceIds: async () => [], reconcile });

    const result = await runBlockedCardsScan(deps);

    expect(result).toEqual({ workspaces: 0, newlyBlocked: 0, notices: 0 });
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe('blockedCardsScan (Inngest wiring — id/cron pinned)', () => {
  // Same rationale as morning-briefing.ts: no @inngest/test harness in the
  // repo, so `runBlockedCardsScan` above carries the real behavior coverage.
  // This only pins the cron wiring.
  it('is registered under id "blocked-cards-scan"', () => {
    expect(blockedCardsScan.id()).toBe('blocked-cards-scan');
  });

  it('triggers on the pinned hourly cron', () => {
    expect(blockedCardsScan.opts.triggers).toEqual([{ cron: '0 * * * *' }]);
  });
});
