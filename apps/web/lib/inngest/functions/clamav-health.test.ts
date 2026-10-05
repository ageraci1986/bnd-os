import { describe, expect, it, vi } from 'vitest';

const { getEmailMock, probeClamavMock } = vi.hoisted(() => ({
  getEmailMock: vi.fn(),
  probeClamavMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@nexushub/db', () => ({ prisma: { user: { findMany: vi.fn() } } }));
vi.mock('@/lib/email', () => ({ getEmail: getEmailMock }));
vi.mock('@/lib/ops/clamav-probe', () => ({ probeClamav: probeClamavMock }));

import {
  ALERT_THRESHOLD,
  CLAMAV_ALERT_SENT_KEY,
  CLAMAV_FAILS_KEY,
  REALERT_AFTER_MS,
  clamavHealth,
  createMemoryStateStore,
  createRedisStateStore,
  probeFromConfig,
  runClamavHealth,
  type ClamavHealthDeps,
  type ClamavHealthEmail,
  type ClamavHealthState,
} from './clamav-health';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function harness(options: {
  up: boolean;
  state?: ClamavHealthState;
  recipients?: readonly string[];
  failFor?: readonly string[];
}) {
  let state: ClamavHealthState = options.state ?? { fails: 0, alertSentAt: null };
  const sent: ClamavHealthEmail[] = [];
  const deps: ClamavHealthDeps = {
    probe: vi.fn(async () => options.up),
    getState: vi.fn(async () => state),
    setState: vi.fn(async (next: ClamavHealthState) => {
      state = next;
    }),
    listRecipients: vi.fn(async () => options.recipients ?? ['a@example.test', 'b@example.test']),
    sendEmail: vi.fn(async (email: ClamavHealthEmail) => {
      if (options.failFor?.includes(email.to)) throw new Error('EMAIL_SEND_FAILED');
      sent.push(email);
    }),
    now: () => NOW,
  };
  return { deps, sent, state: () => state };
}

describe('runClamavHealth', () => {
  it('success with no prior failure: no email, state stays clean', async () => {
    const h = harness({ up: true });
    const result = await runClamavHealth(h.deps);

    expect(result).toEqual({
      up: true,
      fails: 0,
      action: 'none',
      recipients: 0,
      sent: 0,
      failed: 0,
    });
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
    expect(h.deps.listRecipients).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ fails: 0, alertSentAt: null });
  });

  it('success after a single (unalerted) failure resets the counter without email', async () => {
    const h = harness({ up: true, state: { fails: 1, alertSentAt: null } });
    const result = await runClamavHealth(h.deps);

    expect(result.action).toBe('none');
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ fails: 0, alertSentAt: null });
  });

  it('1st failure: counter incremented, no email', async () => {
    const h = harness({ up: false });
    const result = await runClamavHealth(h.deps);

    expect(result).toEqual({
      up: false,
      fails: 1,
      action: 'none',
      recipients: 0,
      sent: 0,
      failed: 0,
    });
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ fails: 1, alertSentAt: null });
  });

  it(`${ALERT_THRESHOLD} consecutive failures: "hors service" email to every recipient, timestamped`, async () => {
    const h = harness({ up: false, state: { fails: 1, alertSentAt: null } });
    const result = await runClamavHealth(h.deps);

    expect(result).toEqual({
      up: false,
      fails: 2,
      action: 'alert',
      recipients: 2,
      sent: 2,
      failed: 0,
    });
    expect(h.sent.map((e) => e.to)).toEqual(['a@example.test', 'b@example.test']);
    const email = h.sent[0];
    expect(email?.subject).toBe('[NexusHub] Antivirus hors service');
    expect(email?.text).toContain('hors service');
    expect(email?.text).toContain('les pièces jointes mail et cartes sont refusées');
    expect(email?.text).toContain('docs/runbooks/card-attachments.md §4');
    expect(email?.text).toContain('2026-10-05 11:50 UTC');
    expect(email?.html).toContain('docs/runbooks/card-attachments.md §4');
    expect(email?.html).toContain('les pièces jointes mail et cartes sont refusées');
    expect(h.state()).toEqual({ fails: 2, alertSentAt: NOW });
  });

  it('3rd failure < 6 h after the alert: no duplicate email', async () => {
    const alertSentAt = NOW - 10 * 60 * 1000;
    const h = harness({ up: false, state: { fails: 2, alertSentAt } });
    const result = await runClamavHealth(h.deps);

    expect(result.action).toBe('none');
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ fails: 3, alertSentAt });
  });

  it('exactly 6 h after the alert: still no reminder (strictly greater required)', async () => {
    const alertSentAt = NOW - REALERT_AFTER_MS;
    const h = harness({ up: false, state: { fails: 36, alertSentAt } });
    const result = await runClamavHealth(h.deps);

    expect(result.action).toBe('none');
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
  });

  it('failure > 6 h after the last alert: reminder sent and re-timestamped', async () => {
    const h = harness({ up: false, state: { fails: 37, alertSentAt: NOW - 6 * HOUR - 1 } });
    const result = await runClamavHealth(h.deps);

    expect(result.action).toBe('alert');
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0]?.subject).toBe('[NexusHub] Antivirus hors service');
    expect(h.state()).toEqual({ fails: 38, alertSentAt: NOW });
  });

  it('recovery after an alert: "rétabli" email and state reset', async () => {
    const h = harness({ up: true, state: { fails: 5, alertSentAt: NOW - HOUR } });
    const result = await runClamavHealth(h.deps);

    expect(result).toEqual({
      up: true,
      fails: 0,
      action: 'recovery',
      recipients: 2,
      sent: 2,
      failed: 0,
    });
    expect(h.sent[0]?.subject).toBe('[NexusHub] Antivirus rétabli');
    expect(h.sent[0]?.text).toContain('docs/runbooks/card-attachments.md §4');
    expect(h.sent[0]?.text).toContain('de nouveau acceptées');
    expect(h.state()).toEqual({ fails: 0, alertSentAt: null });
  });

  it('one recipient failing does not block the others', async () => {
    const h = harness({
      up: false,
      state: { fails: 1, alertSentAt: null },
      recipients: ['a@example.test', 'b@example.test', 'c@example.test'],
      failFor: ['a@example.test'],
    });
    const result = await runClamavHealth(h.deps);

    expect(result).toMatchObject({ action: 'alert', recipients: 3, sent: 2, failed: 1 });
    expect(h.sent.map((e) => e.to)).toEqual(['b@example.test', 'c@example.test']);
    expect(h.state()).toEqual({ fails: 2, alertSentAt: NOW });
  });

  it('all sends failing: alert not marked as sent, so the next tick retries', async () => {
    const h = harness({
      up: false,
      state: { fails: 1, alertSentAt: null },
      failFor: ['a@example.test', 'b@example.test'],
    });
    const result = await runClamavHealth(h.deps);

    expect(result).toMatchObject({ action: 'alert', sent: 0, failed: 2 });
    expect(h.state()).toEqual({ fails: 2, alertSentAt: null });
  });

  it('emails carry no user data (only static content)', async () => {
    const h = harness({ up: false, state: { fails: 1, alertSentAt: null } });
    await runClamavHealth(h.deps);
    for (const email of h.sent) {
      expect(email.text).not.toContain('@');
      expect(email.html).not.toContain('@');
    }
  });
});

describe('probeFromConfig', () => {
  it('host missing ⇒ down, without any network attempt', async () => {
    const probe = vi.fn(async () => true);
    await expect(probeFromConfig({ host: undefined, port: 3310 }, probe)).resolves.toBe(false);
    await expect(probeFromConfig({ host: '', port: 3310 }, probe)).resolves.toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('host present ⇒ delegates to the probe with host/port', async () => {
    const probe = vi.fn(async () => true);
    await expect(probeFromConfig({ host: 'clamav.internal', port: 3310 }, probe)).resolves.toBe(
      true,
    );
    expect(probe).toHaveBeenCalledWith({ host: 'clamav.internal', port: 3310 });
  });

  it('defaults to the real probeClamav', async () => {
    probeClamavMock.mockResolvedValueOnce(false);
    await expect(probeFromConfig({ host: 'clamav.internal', port: 3310 })).resolves.toBe(false);
    expect(probeClamavMock).toHaveBeenCalledWith({ host: 'clamav.internal', port: 3310 });
  });

  it('host missing through the core ⇒ counts as a failure and alerts at threshold', async () => {
    const h = harness({ up: true, state: { fails: 1, alertSentAt: null } });
    const deps: ClamavHealthDeps = {
      ...h.deps,
      probe: () => probeFromConfig({ host: undefined, port: 3310 }),
    };
    const result = await runClamavHealth(deps);
    expect(result).toMatchObject({ up: false, fails: 2, action: 'alert' });
  });
});

describe('state stores', () => {
  it('memory store round-trips the state', async () => {
    const store = createMemoryStateStore();
    await expect(store.get()).resolves.toEqual({ fails: 0, alertSentAt: null });
    await store.set({ fails: 3, alertSentAt: NOW });
    await expect(store.get()).resolves.toEqual({ fails: 3, alertSentAt: NOW });
  });

  it('redis store uses the spec keys, deletes alert_sent on reset, tolerates garbage', async () => {
    const data = new Map<string, unknown>();
    const redis = {
      get: vi.fn(async (key: string) => (data.has(key) ? data.get(key) : null)),
      set: vi.fn(async (key: string, value: unknown) => {
        data.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => (data.delete(key) ? 1 : 0)),
    };
    // Minimal structural fake of the Upstash client (only get/set/del used).
    const store = createRedisStateStore(redis as never);

    await expect(store.get()).resolves.toEqual({ fails: 0, alertSentAt: null });

    await store.set({ fails: 2, alertSentAt: NOW });
    expect(data.get(CLAMAV_FAILS_KEY)).toBe(2);
    expect(data.get(CLAMAV_ALERT_SENT_KEY)).toBe(NOW);
    await expect(store.get()).resolves.toEqual({ fails: 2, alertSentAt: NOW });

    await store.set({ fails: 0, alertSentAt: null });
    expect(data.has(CLAMAV_ALERT_SENT_KEY)).toBe(false);

    data.set(CLAMAV_FAILS_KEY, '4');
    data.set(CLAMAV_ALERT_SENT_KEY, 'not-a-number');
    await expect(store.get()).resolves.toEqual({ fails: 4, alertSentAt: null });
  });
});

describe('clamavHealth (Inngest wire)', () => {
  it('is registered as the 10-minute "clamav-health" cron', () => {
    expect(clamavHealth.id()).toBe('clamav-health');
  });
});
