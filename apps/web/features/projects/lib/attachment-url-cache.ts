import { getCardAttachmentThumbUrls, getCardAttachmentUrl } from '../actions/card-attachments';

/**
 * Cache client des URL signées *inline* des PJ (vignettes + visionneuse).
 * Les URL de lecture expirent après 300 s (`READ_TTL_SECONDS`) : on les
 * réutilise tant qu'elles ont moins de 4 min, sinon on en redemande une —
 * ce qui ménage aussi le rate limit `card_attachment_download`. Les appels
 * concurrents pour une même PJ partagent la même promesse.
 *
 * Vignettes : `getAttachmentThumbUrl` signe TOUTES les images d'une carte en
 * un seul appel (`getCardAttachmentThumbUrls`) et alimente le même cache —
 * la visionneuse réutilise ensuite ces URL sans nouvel appel.
 */
const FRESH_MS = 4 * 60 * 1000;

interface Entry {
  readonly url: string;
  readonly at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();
/** Lot de vignettes en cours, par carte. */
const batchInflight = new Map<string, Promise<void>>();

function fresh(attachmentId: string): string | null {
  const hit = cache.get(attachmentId);
  return hit && Date.now() - hit.at < FRESH_MS ? hit.url : null;
}

function loadThumbBatch(cardId: string): Promise<void> {
  const pending = batchInflight.get(cardId);
  if (pending) return pending;
  const p = getCardAttachmentThumbUrls({ cardId })
    .then((res) => {
      if (!res.ok) return;
      const at = Date.now();
      for (const [id, url] of Object.entries(res.urls)) cache.set(id, { url, at });
    })
    .catch(() => undefined)
    .finally(() => batchInflight.delete(cardId));
  batchInflight.set(cardId, p);
  return p;
}

export async function getAttachmentThumbUrl(
  cardId: string,
  attachmentId: string,
  opts: { readonly force?: boolean } = {},
): Promise<string | null> {
  if (opts.force) cache.delete(attachmentId);
  else {
    const hit = fresh(attachmentId);
    if (hit) return hit;
  }
  await loadThumbBatch(cardId);
  return fresh(attachmentId);
}

export async function getAttachmentInlineUrl(
  attachmentId: string,
  opts: { readonly force?: boolean } = {},
): Promise<string | null> {
  const hit = fresh(attachmentId);
  if (!opts.force && hit) return hit;
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
  batchInflight.clear();
}
