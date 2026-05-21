import 'server-only';

const WINDOW_MS = 60_000;
const lastRun = new Map<string, number>();

// Indirection so tests can control "now" deterministically.
let nowFn: () => number = () => Date.now();
export function __setReconcileNowForTest(ms: number): void {
  nowFn = () => ms;
}

/**
 * Per-workspace throttle: returns true at most once per WINDOW_MS. Reconcile
 * is idempotent, so skipping rapid repeat calls (navigations, residual
 * refetches) is safe — the next window converges the state.
 *
 * Process-local memory (per serverless instance). Good enough: each instance
 * still reconciles within the window; correctness is unaffected by misses.
 */
export function shouldRunReconcile(workspaceId: string): boolean {
  const now = nowFn();
  const prev = lastRun.get(workspaceId);
  if (prev !== undefined && now - prev < WINDOW_MS) return false;
  lastRun.set(workspaceId, now);
  return true;
}
