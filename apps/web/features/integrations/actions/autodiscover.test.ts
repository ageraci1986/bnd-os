import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireUserMock = vi.hoisted(() => vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })));
vi.mock('@/lib/auth', () => ({ requireUser: requireUserMock }));

const autodiscoverFn = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/integrations/imap', () => ({
  autodiscoverImap: (...a: unknown[]) => autodiscoverFn(...a),
}));

import { autodiscoverImapAction } from './autodiscover';

describe('autodiscoverImapAction', () => {
  beforeEach(() => {
    requireUserMock.mockClear();
    autodiscoverFn.mockClear();
  });

  it('requires an authenticated user before probing', async () => {
    autodiscoverFn.mockResolvedValueOnce(null);
    await autodiscoverImapAction({ email: 'me@ovh.net' });
    expect(requireUserMock).toHaveBeenCalledOnce();
  });

  it('forwards the parsed email to autodiscoverImap and returns its result', async () => {
    autodiscoverFn.mockResolvedValueOnce({ host: 'ssl0.ovh.net', port: 993, secure: true });
    const r = await autodiscoverImapAction({ email: 'me@ovh.net' });
    expect(autodiscoverFn).toHaveBeenCalledWith('me@ovh.net');
    expect(r).toEqual({ host: 'ssl0.ovh.net', port: 993, secure: true });
  });

  it('returns null when autodiscovery finds nothing', async () => {
    autodiscoverFn.mockResolvedValueOnce(null);
    const r = await autodiscoverImapAction({ email: 'nobody@nowhere.example' });
    expect(r).toBeNull();
  });

  it('rejects invalid email input before reaching the adapter', async () => {
    await expect(autodiscoverImapAction({ email: 'not-an-email' })).rejects.toThrow();
    expect(autodiscoverFn).not.toHaveBeenCalled();
  });
});
