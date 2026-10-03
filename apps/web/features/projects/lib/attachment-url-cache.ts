import { getCardAttachmentUrl } from '../actions/card-attachments';

/**
 * Cache client des URL signées *inline* des PJ (vignettes + visionneuse).
 * Les URL de lecture expirent après 300 s (`READ_TTL_SECONDS`) : on les
 * réutilise tant qu'elles ont moins de 4 min, sinon on en redemande une —
 * ce qui ménage aussi le rate limit `card_attachment_download`. Les appels
 * concurrents pour une même PJ partagent la même promesse.
 */
const FRESH_MS = 4 * 60 * 1000;

interface Entry {
  readonly url: string;
  readonly at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();

export async function getAttachmentInlineUrl(
  attachmentId: string,
  opts: { readonly force?: boolean } = {},
): Promise<string | null> {
  const hit = cache.get(attachmentId);
  if (!opts.force && hit && Date.now() - hit.at < FRESH_MS) return hit.url;
  const pending = inflight.get(attachmentId);
  if (pending) return pending;

  const p = getCardAttachmentUrl({ attachmentId, disposition: 'inline' })
    .then((res) => {
      if (!res.ok) return null;
      cache.set(attachmentId, { url: res.url, at: Date.now() });
      return res.url;
    })
    .catch(() => null)
    .finally(() => inflight.delete(attachmentId));
  inflight.set(attachmentId, p);
  return p;
}

export function forgetAttachmentUrl(attachmentId: string): void {
  cache.delete(attachmentId);
}

/** Tests only. */
export function resetAttachmentUrlCache(): void {
  cache.clear();
  inflight.clear();
}
