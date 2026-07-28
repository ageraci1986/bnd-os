import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentNoticeInput } from '@/features/notifications/lib/notice-core';

const { emailMessageFindMany, contactFindMany } = vi.hoisted(() => ({
  emailMessageFindMany: vi.fn(),
  contactFindMany: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    emailMessage: { findMany: emailMessageFindMany },
    contact: { findMany: contactFindMany },
  },
}));

import {
  importantMails,
  runImportantMailsScan,
  listCandidateMails,
  listWorkspaceContacts,
  MAX_CANDIDATE_MAILS,
  type ImportantMailsScanDeps,
  type CandidateMail,
  type WorkspaceContact,
} from './important-mails';

// Same stand-in used by morning-briefing.test.ts / blocked-cards-scan.test.ts
// — `step.run` awaits the callback directly so our own try/catch isolation
// (not Inngest's step machinery) is what's under test.
function directRunStep<T>(_stepId: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}

function baseDeps(overrides: Partial<ImportantMailsScanDeps> = {}): ImportantMailsScanDeps {
  return {
    listWorkspaceIds: vi.fn(async () => ['ws-1']),
    listCandidateMails: vi.fn(async () => [] as readonly CandidateMail[]),
    listWorkspaceContacts: vi.fn(async () => [] as readonly WorkspaceContact[]),
    createNotice: vi.fn(async () => ({ created: true })),
    runStep: directRunStep,
    now: () => new Date('2026-07-28T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  emailMessageFindMany.mockReset();
  contactFindMany.mockReset();
});

describe('listCandidateMails (Prisma leaf — where/orderBy/take/select pinned)', () => {
  it('queries unread inbox mails older than the given cutoff, newest first, bounded to 500', async () => {
    emailMessageFindMany.mockResolvedValueOnce([]);
    const before = new Date('2026-07-28T06:00:00Z');

    await listCandidateMails('ws-1', before);

    expect(emailMessageFindMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        isRead: false,
        deletedAt: null,
        archivedAt: null,
        folder: 'inbox',
        receivedAt: { lt: before },
      },
      orderBy: { receivedAt: 'desc' },
      take: MAX_CANDIDATE_MAILS,
      select: {
        id: true,
        fromEmail: true,
        fromName: true,
        integrationId: true,
        integration: { select: { ownerUserId: true } },
      },
    });
  });

  it('pins the bound at exactly 500', () => {
    expect(MAX_CANDIDATE_MAILS).toBe(500);
  });

  it('maps rows to CandidateMail, flattening integration.ownerUserId', async () => {
    emailMessageFindMany.mockResolvedValueOnce([
      {
        id: 'mail-1',
        fromEmail: 'Jane@Acme.com',
        fromName: 'Jane Doe',
        integration: { ownerUserId: 'u1' },
      },
      {
        id: 'mail-2',
        fromEmail: 'nobody@nowhere.com',
        fromName: null,
        integration: { ownerUserId: null },
      },
    ]);

    const result = await listCandidateMails('ws-1', new Date('2026-07-28T06:00:00Z'));

    expect(result).toEqual([
      { id: 'mail-1', fromEmail: 'Jane@Acme.com', fromName: 'Jane Doe', ownerUserId: 'u1' },
      { id: 'mail-2', fromEmail: 'nobody@nowhere.com', fromName: null, ownerUserId: null },
    ]);
  });
});

describe('listWorkspaceContacts (Prisma leaf — where/select pinned)', () => {
  it('queries non-deleted contacts with a known email, selecting email + client name', async () => {
    contactFindMany.mockResolvedValueOnce([]);

    await listWorkspaceContacts('ws-1');

    expect(contactFindMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', deletedAt: null, email: { not: null } },
      select: { email: true, client: { select: { name: true } } },
    });
  });

  it('maps rows to WorkspaceContact, flattening client.name', async () => {
    contactFindMany.mockResolvedValueOnce([{ email: 'jane@acme.com', client: { name: 'Acme' } }]);

    const result = await listWorkspaceContacts('ws-1');

    expect(result).toEqual([{ email: 'jane@acme.com', clientName: 'Acme' }]);
  });
});

describe('runImportantMailsScan', () => {
  it('notifies the mailbox owner when fromEmail matches a known contact (case-insensitive)', async () => {
    const mail: CandidateMail = {
      id: 'mail-1',
      fromEmail: 'Jane@Acme.COM',
      fromName: 'Jane Doe',
      ownerUserId: 'u1',
    };
    const contact: WorkspaceContact = { email: 'jane@acme.com', clientName: 'Acme' };
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listCandidateMails: async () => [mail],
      listWorkspaceContacts: async () => [contact],
      createNotice,
    });

    const result = await runImportantMailsScan(deps);

    expect(createNotice).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'u1',
      kind: 'agent_mail_important',
      message: 'Mail de Jane Doe (Acme) non lu depuis plus de 4 h.',
      data: { ref: 'mail-1', discuss: 'Parlons du mail mail-1 — propose-moi une réponse' },
    } satisfies AgentNoticeInput);
    expect(result.notices).toBe(1);
  });

  it('falls back to fromEmail in the message when fromName is null', async () => {
    const mail: CandidateMail = {
      id: 'mail-1',
      fromEmail: 'jane@acme.com',
      fromName: null,
      ownerUserId: 'u1',
    };
    const contact: WorkspaceContact = { email: 'jane@acme.com', clientName: 'Acme' };
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listCandidateMails: async () => [mail],
      listWorkspaceContacts: async () => [contact],
      createNotice,
    });

    await runImportantMailsScan(deps);

    expect(createNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Mail de jane@acme.com (Acme) non lu depuis plus de 4 h.',
      }),
    );
  });

  it('sends no notice when fromEmail matches no known contact', async () => {
    const mail: CandidateMail = {
      id: 'mail-1',
      fromEmail: 'stranger@nowhere.com',
      fromName: 'Stranger',
      ownerUserId: 'u1',
    };
    const contact: WorkspaceContact = { email: 'jane@acme.com', clientName: 'Acme' };
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listCandidateMails: async () => [mail],
      listWorkspaceContacts: async () => [contact],
      createNotice,
    });

    const result = await runImportantMailsScan(deps);

    expect(createNotice).not.toHaveBeenCalled();
    expect(result.notices).toBe(0);
  });

  it('skips a matching mail whose mailbox has no owner (documented no-op, not an error)', async () => {
    const mail: CandidateMail = {
      id: 'mail-1',
      fromEmail: 'jane@acme.com',
      fromName: 'Jane Doe',
      ownerUserId: null,
    };
    const contact: WorkspaceContact = { email: 'jane@acme.com', clientName: 'Acme' };
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listCandidateMails: async () => [mail],
      listWorkspaceContacts: async () => [contact],
      createNotice,
    });

    const result = await runImportantMailsScan(deps);

    expect(createNotice).not.toHaveBeenCalled();
    expect(result.notices).toBe(0);
  });

  it('passes a cutoff 4 hours before `now` to listCandidateMails', async () => {
    const listCandidateMails = vi.fn(async () => [] as readonly CandidateMail[]);
    const now = () => new Date('2026-07-28T10:00:00Z');
    const deps = baseDeps({ listCandidateMails, now });

    await runImportantMailsScan(deps);

    expect(listCandidateMails).toHaveBeenCalledWith('ws-1', new Date('2026-07-28T06:00:00Z'));
  });

  it('counts only the notices actually created (dedup is the core’s job, spied not reimplemented)', async () => {
    const mailA: CandidateMail = {
      id: 'mail-a',
      fromEmail: 'jane@acme.com',
      fromName: 'Jane',
      ownerUserId: 'u1',
    };
    const mailB: CandidateMail = {
      id: 'mail-b',
      fromEmail: 'jane@acme.com',
      fromName: 'Jane',
      ownerUserId: 'u1',
    };
    const contact: WorkspaceContact = { email: 'jane@acme.com', clientName: 'Acme' };
    const createNotice = vi
      .fn<(input: AgentNoticeInput) => Promise<{ created: boolean }>>()
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });
    const deps = baseDeps({
      listCandidateMails: async () => [mailA, mailB],
      listWorkspaceContacts: async () => [contact],
      createNotice,
    });

    const result = await runImportantMailsScan(deps);

    expect(createNotice).toHaveBeenCalledTimes(2);
    expect(result.notices).toBe(1);
    expect(result.candidates).toBe(2);
  });

  it('runs each workspace scan through runStep with a per-workspace step id', async () => {
    const runStep = vi.fn(directRunStep) as ImportantMailsScanDeps['runStep'];
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-1', 'ws-2'],
      runStep,
    });

    await runImportantMailsScan(deps);

    expect(runStep).toHaveBeenCalledWith('important-mails-ws-1', expect.any(Function));
    expect(runStep).toHaveBeenCalledWith('important-mails-ws-2', expect.any(Function));
  });

  it('isolates workspaces from each other by contact list and mailbox', async () => {
    const mailWs1: CandidateMail = {
      id: 'mail-1',
      fromEmail: 'jane@acme.com',
      fromName: 'Jane',
      ownerUserId: 'u1',
    };
    const mailWs2: CandidateMail = {
      id: 'mail-2',
      fromEmail: 'bob@other.com',
      fromName: 'Bob',
      ownerUserId: 'u2',
    };
    const listCandidateMails = vi.fn(async (workspaceId: string) =>
      workspaceId === 'ws-1' ? [mailWs1] : [mailWs2],
    );
    const listWorkspaceContacts = vi.fn(async (workspaceId: string) =>
      workspaceId === 'ws-1'
        ? [{ email: 'jane@acme.com', clientName: 'Acme' }]
        : [{ email: 'bob@other.com', clientName: 'Other' }],
    );
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-1', 'ws-2'],
      listCandidateMails,
      listWorkspaceContacts,
      createNotice,
    });

    const result = await runImportantMailsScan(deps);

    expect(createNotice).toHaveBeenCalledTimes(2);
    expect(createNotice).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', userId: 'u1' }),
    );
    expect(createNotice).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-2', userId: 'u2' }),
    );
    expect(result).toEqual({ workspaces: 2, candidates: 2, notices: 2 });
  });

  it('isolates failures per workspace: one workspace throwing does not block the others', async () => {
    const mail: CandidateMail = {
      id: 'mail-1',
      fromEmail: 'jane@acme.com',
      fromName: 'Jane',
      ownerUserId: 'u1',
    };
    const contact: WorkspaceContact = { email: 'jane@acme.com', clientName: 'Acme' };
    const listCandidateMails = vi.fn(async (workspaceId: string) => {
      if (workspaceId === 'ws-bad') throw new Error('db down');
      return [mail];
    });
    const createNotice = vi.fn(async () => ({ created: true }));
    const deps = baseDeps({
      listWorkspaceIds: async () => ['ws-bad', 'ws-ok'],
      listCandidateMails,
      listWorkspaceContacts: async () => [contact],
      createNotice,
    });

    const result = await runImportantMailsScan(deps);

    expect(createNotice).toHaveBeenCalledTimes(1);
    expect(result.notices).toBe(1);
    expect(result.workspaces).toBe(2);
  });

  it('returns zero counts and calls nothing else when there are no workspaces', async () => {
    const listCandidateMails = vi.fn(async () => [] as readonly CandidateMail[]);
    const deps = baseDeps({ listWorkspaceIds: async () => [], listCandidateMails });

    const result = await runImportantMailsScan(deps);

    expect(result).toEqual({ workspaces: 0, candidates: 0, notices: 0 });
    expect(listCandidateMails).not.toHaveBeenCalled();
  });
});

describe('importantMails (Inngest wiring — id/cron pinned)', () => {
  // Same rationale as morning-briefing.ts/blocked-cards-scan.ts: no
  // @inngest/test harness in the repo, so `runImportantMailsScan` above
  // carries the real behavior coverage. This only pins the cron wiring.
  it('is registered under id "important-mails"', () => {
    expect(importantMails.id()).toBe('important-mails');
  });

  it('triggers every 30 minutes', () => {
    expect(importantMails.opts.triggers).toEqual([{ cron: '*/30 * * * *' }]);
  });
});
