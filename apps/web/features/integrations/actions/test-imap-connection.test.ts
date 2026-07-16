import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const rlCheck = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: vi.fn(() => ({ check: rlCheck })),
  getClientIp: vi.fn(() => 'ip'),
}));

const testFn = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/integrations/imap', () => ({
  testImapConnection: (...a: unknown[]) => testFn(...a),
}));

import { testImapConnectionAction } from './test-imap-connection';

describe('testImapConnectionAction', () => {
  it('returns 429 when rate limit exhausted', async () => {
    rlCheck.mockResolvedValueOnce({ success: false, remaining: 0, reset: Date.now() + 300_000 });
    const r = await testImapConnectionAction({
      host: 'h',
      port: 993,
      secure: true,
      username: 'u',
      password: 'p',
    });
    expect(r).toEqual({ ok: false, code: 'RATE_LIMIT', message: expect.any(String) });
    expect(testFn).not.toHaveBeenCalled();
  });

  it('forwards to testImapConnection when rate limit ok', async () => {
    rlCheck.mockResolvedValueOnce({ success: true, remaining: 4, reset: Date.now() + 300_000 });
    testFn.mockResolvedValueOnce({ ok: true });
    const r = await testImapConnectionAction({
      host: 'h',
      port: 993,
      secure: true,
      username: 'u',
      password: 'p',
    });
    expect(r).toEqual({ ok: true });
    expect(testFn).toHaveBeenCalledOnce();
  });
});
