import { describe, expect, it, vi } from 'vitest';
import type { AgentNoticeInput } from '@/features/notifications/lib/notice-core';
import type { NewlyBlockedCard } from '@/features/projects/lib/reconcile';
import {
  blockedCardsScan,
  runBlockedCardsScan,
  type BlockedCardsScanDeps,
} from './blocked-cards-scan';

// Same stand-in used by morning-briefing.test.ts — `step.run` awaits the
// callback directly so our own try/catch isolation (not Inngest's step
// machinery) is what's under test.
function directRunStep<T>(_stepId: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}

function baseDeps(overrides: Partial<BlockedCardsScanDeps> = {}): BlockedCardsScanDeps {
  return {
    listWorkspaceIds: vi.fn(async () => ['ws-1']),
    reconcile: vi.fn(async () => ({ newlyBlocked: [] as readonly NewlyBlockedCard[] })),
    listProjectMemberUserIds: vi.fn(async () => []),
    createNotice: vi.fn(async () => ({ created: true })),
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

  it('notifies every member of the project for a newly-blocked card (multi-member -> one notice each)', async () => {
    const card: NewlyBlockedCard = { cardId: 'card-1', title: 'Overdue card', projectId: 'proj-1' };
    const listProjectMemberUserIds = vi.fn(async (projectId: string) =>
      projectId === 'proj-1' ? ['u1', 'u2'] : [],
    );
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      reconcile: async () => ({ newlyBlocked: [card] }),
      listProjectMemberUserIds,
      createNotice,
    });

    const result = await runBlockedCardsScan(deps);

    expect(listProjectMemberUserIds).toHaveBeenCalledWith('proj-1');
    expect(createNotice).toHaveBeenCalledTimes(2);
    expect(createNotice).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'u1',
      kind: 'agent_card_blocked',
      message: '« Overdue card » est passée en Bloqué (échéance dépassée).',
      data: { ref: 'card-1', discuss: 'Parlons de la carte card-1 passée en Bloqué' },
    } satisfies AgentNoticeInput);
    expect(createNotice).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'u2',
      kind: 'agent_card_blocked',
      message: '« Overdue card » est passée en Bloqué (échéance dépassée).',
      data: { ref: 'card-1', discuss: 'Parlons de la carte card-1 passée en Bloqué' },
    } satisfies AgentNoticeInput);
    expect(result.notices).toBe(2);
  });

  it('sends no notice when the project has no members (documented no-op, not an error)', async () => {
    const card: NewlyBlockedCard = { cardId: 'card-1', title: 'Orphan card', projectId: 'proj-1' };
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      reconcile: async () => ({ newlyBlocked: [card] }),
      listProjectMemberUserIds: async () => [],
      createNotice,
    });

    const result = await runBlockedCardsScan(deps);

    expect(createNotice).not.toHaveBeenCalled();
    expect(result.notices).toBe(0);
  });

  it('counts only the notices actually created (dedup is the core’s job, spied not reimplemented)', async () => {
    const card: NewlyBlockedCard = { cardId: 'card-1', title: 'Card', projectId: 'proj-1' };
    const createNotice = vi
      .fn<(input: AgentNoticeInput) => Promise<{ created: boolean }>>()
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });
    const deps = baseDeps({
      reconcile: async () => ({ newlyBlocked: [card] }),
      listProjectMemberUserIds: async () => ['u1', 'u2'],
      createNotice,
    });

    const result = await runBlockedCardsScan(deps);

    expect(createNotice).toHaveBeenCalledTimes(2);
    expect(result.notices).toBe(1);
  });

  it('runs each workspace scan through runStep with a per-workspace step id', async () => {
    const runStep = vi.fn(directRunStep) as BlockedCardsScanDeps['runStep'];
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-1', 'ws-2'],
      runStep,
    });

    await runBlockedCardsScan(deps);

    expect(runStep).toHaveBeenCalledWith('scan-ws-1', expect.any(Function));
    expect(runStep).toHaveBeenCalledWith('scan-ws-2', expect.any(Function));
  });

  it('isolates failures per workspace: one workspace throwing does not block the others', async () => {
    const card: NewlyBlockedCard = { cardId: 'card-2', title: 'Card 2', projectId: 'proj-1' };
    const reconcile = vi.fn(async (workspaceId: string) => {
      if (workspaceId === 'ws-bad') throw new Error('db down');
      return { newlyBlocked: [card] as readonly NewlyBlockedCard[] };
    });
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-bad', 'ws-ok'],
      reconcile,
      listProjectMemberUserIds: async () => ['u1'],
      createNotice,
    });

    const result = await runBlockedCardsScan(deps);

    expect(createNotice).toHaveBeenCalledTimes(1);
    expect(result.notices).toBe(1);
    expect(result.workspaces).toBe(2);
  });

  it('isolates failures per workspace when listProjectMemberUserIds throws too', async () => {
    const card: NewlyBlockedCard = { cardId: 'card-3', title: 'Card 3', projectId: 'proj-bad' };
    const otherCard: NewlyBlockedCard = { cardId: 'card-4', title: 'Card 4', projectId: 'proj-ok' };
    const reconcile = vi.fn(async (workspaceId: string) =>
      workspaceId === 'ws-bad'
        ? { newlyBlocked: [card] as readonly NewlyBlockedCard[] }
        : { newlyBlocked: [otherCard] as readonly NewlyBlockedCard[] },
    );
    const listProjectMemberUserIds = vi.fn(async (projectId: string) => {
      if (projectId === 'proj-bad') throw new Error('boom');
      return ['u1'];
    });
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-bad', 'ws-ok'],
      reconcile,
      listProjectMemberUserIds,
      createNotice,
    });

    const result = await runBlockedCardsScan(deps);

    expect(createNotice).toHaveBeenCalledTimes(1);
    expect(result.notices).toBe(1);
  });

  it('returns workspaces/newlyBlocked/notices counts across multiple workspaces', async () => {
    const cardA: NewlyBlockedCard = { cardId: 'card-a', title: 'A', projectId: 'proj-a' };
    const cardB: NewlyBlockedCard = { cardId: 'card-b', title: 'B', projectId: 'proj-b' };
    const reconcile = vi.fn(async (workspaceId: string) =>
      workspaceId === 'ws-1'
        ? { newlyBlocked: [cardA] as readonly NewlyBlockedCard[] }
        : { newlyBlocked: [cardB] as readonly NewlyBlockedCard[] },
    );
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-1', 'ws-2'],
      reconcile,
      listProjectMemberUserIds: async () => ['u1'],
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
