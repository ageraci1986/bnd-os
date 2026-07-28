import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — repo convention, see
// `apps/web/features/clients/lib/client-core.test.ts`.
const prismaMock = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  notificationPreference: { findUnique: vi.fn() },
  notification: { findMany: vi.fn(), create: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));

import { createAgentNotice, type AgentNoticeInput } from './notice-core';

const WORKSPACE_ID = 'ws-1';
const USER_ID = 'user-1';

function baseInput(overrides: Partial<AgentNoticeInput> = {}): AgentNoticeInput {
  return {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    kind: 'agent_card_blocked',
    message: '« Refonte site » est passée en Bloqué (échéance dépassée)',
    data: { ref: 'card-123', discuss: 'Parlons de la carte card-123 passée en Bloqué' },
    ...overrides,
  };
}

function activeMembership(
  overrides: Partial<{ assistantProactivity: boolean; assistantBriefingOptIn: boolean }> = {},
) {
  return { assistantProactivity: true, assistantBriefingOptIn: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.membership.findUnique.mockResolvedValue(activeMembership());
  prismaMock.notificationPreference.findUnique.mockResolvedValue(null);
  prismaMock.notification.findMany.mockResolvedValue([]);
  prismaMock.notification.create.mockResolvedValue({ id: 'notif-1' });
});

describe('createAgentNotice', () => {
  it('returns created:false and performs no further lookup when the membership is missing', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce(null);
    const result = await createAgentNotice(baseInput());
    expect(result).toEqual({ created: false });
    expect(prismaMock.membership.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: USER_ID } },
      select: { assistantProactivity: true, assistantBriefingOptIn: true },
    });
    expect(prismaMock.notificationPreference.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.notification.findMany).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('returns created:false when the workspace kill switch (assistantProactivity) is off', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce(
      activeMembership({ assistantProactivity: false }),
    );
    const result = await createAgentNotice(baseInput());
    expect(result).toEqual({ created: false });
    expect(prismaMock.notificationPreference.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('returns created:false for agent_briefing when the user has not opted in', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce(
      activeMembership({ assistantBriefingOptIn: false }),
    );
    const result = await createAgentNotice(
      baseInput({
        kind: 'agent_briefing',
        data: { ref: 'briefing-2026-07-28', discuss: 'Détaille mon briefing du jour' },
      }),
    );
    expect(result).toEqual({ created: false });
    expect(prismaMock.notificationPreference.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('does not gate non-briefing kinds on assistantBriefingOptIn', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce(
      activeMembership({ assistantBriefingOptIn: false }),
    );
    const result = await createAgentNotice(baseInput({ kind: 'agent_card_blocked' }));
    expect(result).toEqual({ created: true });
  });

  it('creates agent_briefing when opted in', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce(
      activeMembership({ assistantBriefingOptIn: true }),
    );
    const result = await createAgentNotice(
      baseInput({
        kind: 'agent_briefing',
        data: { ref: 'briefing-2026-07-28', discuss: 'Détaille mon briefing du jour' },
      }),
    );
    expect(result).toEqual({ created: true });
  });

  it('returns created:false when the per-kind NotificationPreference is disabled', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValueOnce({ enabled: false });
    const result = await createAgentNotice(baseInput());
    expect(result).toEqual({ created: false });
    expect(prismaMock.notificationPreference.findUnique).toHaveBeenCalledWith({
      where: {
        userId_kind_channel: { userId: USER_ID, kind: 'agent_card_blocked', channel: 'in_app' },
      },
      select: { enabled: true },
    });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('proceeds when no NotificationPreference row exists (enabled by default)', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValueOnce(null);
    const result = await createAgentNotice(baseInput());
    expect(result).toEqual({ created: true });
  });

  it('proceeds when the NotificationPreference row is explicitly enabled', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValueOnce({ enabled: true });
    const result = await createAgentNotice(baseInput());
    expect(result).toEqual({ created: true });
  });

  it('skips creation when an unread notification with the same (userId, kind, data.ref) exists', async () => {
    prismaMock.notification.findMany.mockResolvedValueOnce([
      { data: { ref: 'card-999' } },
      { data: { ref: 'card-123' } },
    ]);
    const result = await createAgentNotice(baseInput({ data: { ref: 'card-123', discuss: 'x' } }));
    expect(result).toEqual({ created: false });
    expect(prismaMock.notification.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, kind: 'agent_card_blocked', readAt: null },
      select: { data: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('re-creates when the only matching notification for that ref has already been read', async () => {
    // The real query filters on readAt: null, so a read notification never
    // surfaces here — the mock simulates that by returning an empty list.
    prismaMock.notification.findMany.mockResolvedValueOnce([]);
    const result = await createAgentNotice(baseInput({ data: { ref: 'card-123', discuss: 'x' } }));
    expect(result).toEqual({ created: true });
  });

  it('skips the dedup lookup entirely when data.ref is undefined', async () => {
    const result = await createAgentNotice(baseInput({ data: { discuss: 'sans ref' } }));
    expect(result).toEqual({ created: true });
    expect(prismaMock.notification.findMany).not.toHaveBeenCalled();
  });

  it('creates the notification with the exact pinned shape (workspaceId/userId/kind/channel/data)', async () => {
    const result = await createAgentNotice(baseInput());
    expect(result).toEqual({ created: true });
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: {
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        kind: 'agent_card_blocked',
        channel: 'in_app',
        data: {
          message: '« Refonte site » est passée en Bloqué (échéance dépassée)',
          ref: 'card-123',
          discuss: 'Parlons de la carte card-123 passée en Bloqué',
        },
      },
    });
  });

  it('omits the ref key from the stored data when the caller does not supply one', async () => {
    await createAgentNotice(baseInput({ data: { discuss: 'sans ref' } }));
    const call = prismaMock.notification.create.mock.calls[0]![0] as {
      data: { data: Record<string, unknown> };
    };
    expect(call.data.data).toEqual({ message: baseInput().message, discuss: 'sans ref' });
    expect('ref' in call.data.data).toBe(false);
  });

  it('does not strip or alter the message/discuss text (no PII scrubbing performed by the core)', async () => {
    const input = baseInput({
      message: 'Mail de Jean Dupont (Acme) non lu depuis plus de 4 h',
      data: { ref: 'mail-42', discuss: 'Parlons du mail mail-42 — propose-moi une réponse' },
    });
    await createAgentNotice(input);
    const call = prismaMock.notification.create.mock.calls[0]![0] as {
      data: { data: Record<string, unknown> };
    };
    expect(call.data.data['message']).toBe(input.message);
    expect(call.data.data['discuss']).toBe(input.data.discuss);
  });
});
