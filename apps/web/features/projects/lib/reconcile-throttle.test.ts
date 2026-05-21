import { describe, expect, it, beforeEach } from 'vitest';
import { __setReconcileNowForTest, shouldRunReconcile } from './reconcile-throttle';

beforeEach(() => {
  __setReconcileNowForTest(0);
  // Reset internal state between tests by advancing well past the window
  // for any workspace used; tests use distinct ws ids where needed.
});

describe('shouldRunReconcile (per-workspace throttle)', () => {
  it('runs the first time for a workspace', () => {
    expect(shouldRunReconcile('ws-first')).toBe(true);
  });

  it('skips a second call within the window', () => {
    __setReconcileNowForTest(1000);
    expect(shouldRunReconcile('ws-window')).toBe(true);
    __setReconcileNowForTest(1000 + 30_000); // 30s later, < 60s window
    expect(shouldRunReconcile('ws-window')).toBe(false);
  });

  it('runs again after the window elapses', () => {
    __setReconcileNowForTest(2000);
    expect(shouldRunReconcile('ws-elapsed')).toBe(true);
    __setReconcileNowForTest(2000 + 61_000);
    expect(shouldRunReconcile('ws-elapsed')).toBe(true);
  });

  it('tracks workspaces independently', () => {
    __setReconcileNowForTest(5000);
    expect(shouldRunReconcile('ws-a')).toBe(true);
    expect(shouldRunReconcile('ws-b')).toBe(true);
  });
});
