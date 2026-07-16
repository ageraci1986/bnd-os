/**
 * Microsoft Graph fetch wrapper with retry on transient failures (429, 503).
 * Adapter layer: no Next dependency, no logging of secrets.
 */
export class GraphError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Graph request failed: ${status}`);
    this.name = 'GraphError';
    this.status = status;
    this.body = body;
  }
}

export interface GraphFetchOptions {
  readonly token: string;
  readonly method?: 'GET' | 'POST';
  readonly body?: string;
  readonly contentType?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxRetries?: number;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

const RETRYABLE = new Set<number>([429, 500, 502, 503, 504]);

export async function graphFetch<T>(url: string, opts: GraphFetchOptions): Promise<T> {
  const sleep = opts.sleep ?? DEFAULT_SLEEP;
  const maxRetries = opts.maxRetries ?? 3;
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}),
      },
      ...(opts.body ? { body: opts.body } : {}),
    });
    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        // Some endpoints (e.g. /sendMail, /reply, /forward) return 202 Accepted
        // with an empty body — res.json() throws on that; treat as no payload.
        return undefined as T;
      }
    }
    if (RETRYABLE.has(res.status) && attempt < maxRetries) {
      const backoff = 1000 * Math.pow(2, attempt);
      attempt += 1;
      await sleep(backoff);
      continue;
    }
    const body = await res.text().catch(() => '');
    throw new GraphError(res.status, body);
  }
}
