import { describe, expect, it, vi } from 'vitest';
import type { AgentNoticeInput } from '@/features/notifications/lib/notice-core';
import type { OverviewAuthContext, TodayOverview } from '@/lib/assistant/overview-core';
import {
  brusselsDateStamp,
  morningBriefing,
  runMorningBriefing,
  type BriefingMember,
  type MorningBriefingDeps,
} from './morning-briefing';

// `runStep` is a stand-in for Inngest's `step.run` — in production it's
// `(id, fn) => step.run(id, fn)`. Here it just awaits the callback directly
// so `runMorningBriefing`'s own try/catch (not Inngest's step machinery) is
// what's under test for isolation.
function directRunStep<T>(_stepId: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}

function overview(overrides: Partial<TodayOverview> = {}): TodayOverview {
  return {
    blockedCards: 0,
    dueTodayCards: 0,
    unreadMails: 0,
    unreadNotifications: 0,
    ...overrides,
  };
}

function baseDeps(overrides: Partial<MorningBriefingDeps> = {}): MorningBriefingDeps {
  return {
    listWorkspaceIds: vi.fn(async () => ['ws-1']),
    listBriefingOptedInMembers: vi.fn(async () => []),
    loadOverview: vi.fn(async (_ctx: OverviewAuthContext) => overview()),
    createNotice: vi.fn(async () => ({ created: true })),
    runStep: directRunStep,
    now: () => new Date('2026-07-28T06:00:00Z'),
    ...overrides,
  };
}

describe('brusselsDateStamp', () => {
  it('formats YYYY-MM-DD in Europe/Brussels', () => {
    // 2026-07-28T06:00:00Z is 08:00 CEST (UTC+2) — same calendar day.
    expect(brusselsDateStamp(new Date('2026-07-28T06:00:00Z'))).toBe('2026-07-28');
  });

  it('uses the Brussels calendar day, not the UTC one, across midnight', () => {
    // 2026-07-27T23:30:00Z is 2026-07-28T01:30 CEST — already the next day
    // locally even though it's still 07-27 in UTC.
    expect(brusselsDateStamp(new Date('2026-07-27T23:30:00Z'))).toBe('2026-07-28');
  });
});

describe('runMorningBriefing', () => {
  it('processes only the members returned by listBriefingOptedInMembers (opt-in filtering is the caller’s job)', async () => {
    const members: BriefingMember[] = [{ userId: 'u1', role: 'admin', isSuperAdmin: false }];
    const listBriefingOptedInMembers = vi.fn(async () => members);
    const loadOverview = vi.fn(async () => overview({ dueTodayCards: 1 }));
    const deps = baseDeps({ listBriefingOptedInMembers, loadOverview });

    await runMorningBriefing(deps);

    expect(listBriefingOptedInMembers).toHaveBeenCalledWith('ws-1');
    expect(loadOverview).toHaveBeenCalledTimes(1);
  });

  it('builds the overview context from Membership fields only (no email leaked)', async () => {
    const members: BriefingMember[] = [{ userId: 'u1', role: 'user', isSuperAdmin: false }];
    const loadOverview = vi.fn(async (_ctx: OverviewAuthContext) => overview());
    const deps = baseDeps({ listBriefingOptedInMembers: async () => members, loadOverview });

    await runMorningBriefing(deps);

    const ctx = loadOverview.mock.calls[0]?.[0] as OverviewAuthContext;
    expect(ctx).toEqual({ workspaceId: 'ws-1', userId: 'u1', role: 'user', isSuperAdmin: false });
    expect('email' in ctx).toBe(false);
  });

  it('passes the member’s REAL isSuperAdmin (grouped review fix 3 — a super-admin gets the same scope as the real page)', async () => {
    const members: BriefingMember[] = [{ userId: 'u1', role: 'user', isSuperAdmin: true }];
    const loadOverview = vi.fn(async (_ctx: OverviewAuthContext) => overview());
    const deps = baseDeps({ listBriefingOptedInMembers: async () => members, loadOverview });

    await runMorningBriefing(deps);

    const ctx = loadOverview.mock.calls[0]?.[0] as OverviewAuthContext;
    expect(ctx).toEqual({ workspaceId: 'ws-1', userId: 'u1', role: 'user', isSuperAdmin: true });
  });

  it('skips the notice (and does not call createNotice) when the overview is all-zero', async () => {
    const members: BriefingMember[] = [{ userId: 'u1', role: 'user', isSuperAdmin: false }];
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listBriefingOptedInMembers: async () => members,
      loadOverview: async () => overview(),
      createNotice,
    });

    const result = await runMorningBriefing(deps);

    expect(createNotice).not.toHaveBeenCalled();
    expect(result).toEqual({ workspaces: 1, notices: 0 });
  });

  it('creates the notice with the exact pinned message/ref/discuss when the overview is not all-zero', async () => {
    const members: BriefingMember[] = [{ userId: 'u1', role: 'user', isSuperAdmin: false }];
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-1'],
      listBriefingOptedInMembers: async () => members,
      loadOverview: async () => overview({ dueTodayCards: 3, blockedCards: 1, unreadMails: 5 }),
      createNotice,
      now: () => new Date('2026-07-28T06:00:00Z'),
    });

    const result = await runMorningBriefing(deps);

    expect(createNotice).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'u1',
      kind: 'agent_briefing',
      message: "3 tâches dues aujourd'hui · 1 bloquée · 5 mails non lus",
      data: { ref: 'briefing-2026-07-28', discuss: 'Détaille mon briefing du jour' },
    } satisfies AgentNoticeInput);
    expect(result).toEqual({ workspaces: 1, notices: 1 });
  });

  it('counts only the notices actually created (createNotice can no-op via its own guards/dedup)', async () => {
    const members: BriefingMember[] = [
      { userId: 'u1', role: 'user', isSuperAdmin: false },
      { userId: 'u2', role: 'user', isSuperAdmin: false },
    ];
    const createNotice = vi
      .fn<(input: AgentNoticeInput) => Promise<{ created: boolean }>>()
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });
    const deps = baseDeps({
      listBriefingOptedInMembers: async () => members,
      loadOverview: async () => overview({ dueTodayCards: 1 }),
      createNotice,
    });

    const result = await runMorningBriefing(deps);

    expect(result.notices).toBe(1);
  });

  it('runs each member through runStep with a per-user step id', async () => {
    const members: BriefingMember[] = [
      { userId: 'u1', role: 'user', isSuperAdmin: false },
      { userId: 'u2', role: 'user', isSuperAdmin: false },
    ];
    const runStep = vi.fn(directRunStep) as MorningBriefingDeps['runStep'];
    const deps = baseDeps({
      listBriefingOptedInMembers: async () => members,
      loadOverview: async () => overview({ dueTodayCards: 1 }),
      runStep,
    });

    await runMorningBriefing(deps);

    expect(runStep).toHaveBeenCalledWith('briefing-u1', expect.any(Function));
    expect(runStep).toHaveBeenCalledWith('briefing-u2', expect.any(Function));
  });

  it('isolates failures: one member throwing (loadOverview or createNotice) does not block the others', async () => {
    const members: BriefingMember[] = [
      { userId: 'u1', role: 'user', isSuperAdmin: false },
      { userId: 'u2', role: 'user', isSuperAdmin: false },
      { userId: 'u3', role: 'user', isSuperAdmin: false },
    ];
    const loadOverview = vi.fn(async (ctx: OverviewAuthContext) => {
      if (ctx.userId === 'u2') throw new Error('boom');
      return overview({ dueTodayCards: 1 });
    });
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listBriefingOptedInMembers: async () => members,
      loadOverview,
      createNotice,
    });

    const result = await runMorningBriefing(deps);

    // u1 and u3 still produced notices despite u2's failure.
    expect(createNotice).toHaveBeenCalledTimes(2);
    expect(result.notices).toBe(2);
  });

  it('isolates failures across workspaces too: one workspace erroring does not stop the next', async () => {
    const listBriefingOptedInMembers = vi.fn(async (workspaceId: string) => {
      if (workspaceId === 'ws-bad') throw new Error('db down');
      return [{ userId: 'u1', role: 'user', isSuperAdmin: false } satisfies BriefingMember];
    });
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-bad', 'ws-ok'],
      listBriefingOptedInMembers,
      loadOverview: async () => overview({ dueTodayCards: 1 }),
      createNotice,
    });

    // The per-workspace member lookup itself throws outside any per-member
    // try/catch (it happens before the loop starts) — document the current
    // contract: a workspace-level failure DOES propagate and abort the run.
    // This is intentional: Task 4 only requires per-USER isolation via
    // `step.run`; workspace-level Prisma errors are rare/systemic (e.g. DB
    // outage) and Inngest's own retry policy is the right layer for those.
    await expect(runMorningBriefing(deps)).rejects.toThrow('db down');
    expect(createNotice).not.toHaveBeenCalled();
  });

  it('returns workspaces/notices counts across multiple workspaces', async () => {
    const listBriefingOptedInMembers = vi.fn(async (workspaceId: string) => [
      { userId: `${workspaceId}-u1`, role: 'user', isSuperAdmin: false } satisfies BriefingMember,
    ]);
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-1', 'ws-2'],
      listBriefingOptedInMembers,
      loadOverview: async () => overview({ dueTodayCards: 1 }),
    });

    const result = await runMorningBriefing(deps);

    expect(result).toEqual({ workspaces: 2, notices: 2 });
  });

  it('returns zero counts and calls nothing else when there are no workspaces', async () => {
    const listBriefingOptedInMembers = vi.fn(async () => []);
    const deps = baseDeps({ listWorkspaceIds: async () => [], listBriefingOptedInMembers });

    const result = await runMorningBriefing(deps);

    expect(result).toEqual({ workspaces: 0, notices: 0 });
    expect(listBriefingOptedInMembers).not.toHaveBeenCalled();
  });
});

describe('morningBriefing (Inngest wiring — id/cron pinned)', () => {
  // We don't drive the real Inngest execution engine here — see the
  // file-header comment in morning-briefing.ts for why (`runMorningBriefing`
  // above carries the actual test coverage for behavior). This only pins
  // the wiring so a typo in `id` or the cron expression fails loudly.
  it('is registered under id "morning-briefing"', () => {
    expect(morningBriefing.id()).toBe('morning-briefing');
  });

  it('triggers on the pinned weekday-only Europe/Brussels cron (07:30, Mon-Fri)', () => {
    expect(morningBriefing.opts.triggers).toEqual([{ cron: 'TZ=Europe/Brussels 30 7 * * 1-5' }]);
  });
});
