import { describe, it, expect } from 'vitest';
import { checkMailSendRate, getRateLimiter } from './index';

describe('checkMailSendRate', () => {
  it('returns hour-window fail when the hourly limit (50) is exhausted', async () => {
    // Unique identifier per test — the in-memory backend is module-scoped
    // and shared across tests in this file, so reuse would cause interference.
    const userId = 'hour-exhausted-user';
    for (let i = 0; i < 50; i++) {
      await getRateLimiter('mail_send_hour').check(userId);
    }
    const r = await checkMailSendRate(userId);
    expect(r.success).toBe(false);
    expect(r.window).toBe('hour');
    expect(typeof r.reset).toBe('number');
  });

  it('returns day-window fail when the daily limit (300) is exhausted but hour has room', async () => {
    const userId = 'day-exhausted-user';
    // Exhaust the day window directly without touching the hour window,
    // then confirm checkMailSendRate reports 'day' after consuming one hour slot.
    for (let i = 0; i < 300; i++) {
      await getRateLimiter('mail_send_day').check(userId);
    }
    const r = await checkMailSendRate(userId);
    expect(r.success).toBe(false);
    expect(r.window).toBe('day');
    expect(typeof r.reset).toBe('number');
  });

  it('succeeds when both windows have room', async () => {
    const r = await checkMailSendRate('u-fresh');
    expect(r).toEqual({ success: true, window: null, reset: expect.any(Number) });
  });
});
