import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  membershipUpdate: vi.fn(),
  notificationPreferenceUpsert: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@nexushub/db', () => ({
  prisma: {
    membership: { update: mocks.membershipUpdate },
    notificationPreference: { upsert: mocks.notificationPreferenceUpsert },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { updateAssistantPreferences } from './update-assistant-preferences';

const CTX = {
  userId: 'u-1',
  workspaceId: 'ws-1',
  role: 'user',
  isSuperAdmin: false,
  email: 'user@test',
};

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.requireUser.mockResolvedValue(CTX);
  mocks.membershipUpdate.mockResolvedValue({});
  mocks.notificationPreferenceUpsert.mockResolvedValue({});
});

describe('updateAssistantPreferences', () => {
  it('rejects an empty input (at least one field required) without touching the DB', async () => {
    const result = await updateAssistantPreferences({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/au moins un champ/i);
    }
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.membershipUpdate).not.toHaveBeenCalled();
    expect(mocks.notificationPreferenceUpsert).not.toHaveBeenCalled();
  });

  it('rejects an input with only an empty kinds object', async () => {
    const result = await updateAssistantPreferences({ kinds: {} });
    expect(result.ok).toBe(false);
  });

  it('updates only assistantProactivity when only proactivity is provided, scoped to workspace+user', async () => {
    const result = await updateAssistantPreferences({ proactivity: false });
    expect(result).toEqual({ ok: true });
    expect(mocks.membershipUpdate).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'u-1' } },
      data: { assistantProactivity: false },
    });
    expect(mocks.notificationPreferenceUpsert).not.toHaveBeenCalled();
  });

  it('updates only assistantBriefingOptIn when only briefingOptIn is provided', async () => {
    const result = await updateAssistantPreferences({ briefingOptIn: true });
    expect(result).toEqual({ ok: true });
    expect(mocks.membershipUpdate).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'u-1' } },
      data: { assistantBriefingOptIn: true },
    });
  });

  it('updates both Membership flags in one call when both are provided', async () => {
    const result = await updateAssistantPreferences({ proactivity: true, briefingOptIn: false });
    expect(result).toEqual({ ok: true });
    expect(mocks.membershipUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.membershipUpdate).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'u-1' } },
      data: { assistantProactivity: true, assistantBriefingOptIn: false },
    });
  });

  it('upserts a NotificationPreference row per kind provided, channel pinned to in_app, scoped to the user', async () => {
    const result = await updateAssistantPreferences({
      kinds: { agent_card_blocked: false, agent_mail_important: true },
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.membershipUpdate).not.toHaveBeenCalled();
    expect(mocks.notificationPreferenceUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.notificationPreferenceUpsert).toHaveBeenCalledWith({
      where: {
        userId_kind_channel: { userId: 'u-1', kind: 'agent_card_blocked', channel: 'in_app' },
      },
      create: { userId: 'u-1', kind: 'agent_card_blocked', channel: 'in_app', enabled: false },
      update: { enabled: false },
    });
    expect(mocks.notificationPreferenceUpsert).toHaveBeenCalledWith({
      where: {
        userId_kind_channel: { userId: 'u-1', kind: 'agent_mail_important', channel: 'in_app' },
      },
      create: { userId: 'u-1', kind: 'agent_mail_important', channel: 'in_app', enabled: true },
      update: { enabled: true },
    });
  });

  it('handles a mixed payload (Membership flags + kinds) in a single call', async () => {
    const result = await updateAssistantPreferences({
      proactivity: false,
      kinds: { agent_briefing: true },
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.membershipUpdate).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'u-1' } },
      data: { assistantProactivity: false },
    });
    expect(mocks.notificationPreferenceUpsert).toHaveBeenCalledWith({
      where: { userId_kind_channel: { userId: 'u-1', kind: 'agent_briefing', channel: 'in_app' } },
      create: { userId: 'u-1', kind: 'agent_briefing', channel: 'in_app', enabled: true },
      update: { enabled: true },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings');
  });

  it('rejects a non-boolean value for proactivity', async () => {
    const result = await updateAssistantPreferences({
      // any: intentional bad input to exercise Zod validation
      proactivity: 'yes' as unknown as boolean,
    });
    expect(result.ok).toBe(false);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it('rejects an unknown kind key', async () => {
    const result = await updateAssistantPreferences({
      kinds: { not_a_real_kind: true } as unknown as Record<string, boolean>,
    });
    expect(result.ok).toBe(false);
  });
});
