import 'server-only';

/**
 * Wrap a server-side async block to log its duration in development only.
 * No-op in production. Use to objectivise before/after on hot actions.
 */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (process.env['NODE_ENV'] === 'production') return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    // eslint-disable-next-line no-console -- dev-only diagnostic
    console.debug(`[perf] ${label}: ${(performance.now() - start).toFixed(0)}ms`);
  }
}
