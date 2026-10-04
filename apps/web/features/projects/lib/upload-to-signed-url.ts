/**
 * Upload direct navigateur → Supabase Storage via l'URL signée renvoyée par
 * `requestCardAttachmentUpload` (lot C, spec §3).
 *
 * Format du corps — calqué sur `StorageFileApi.uploadToSignedUrl` de
 * `@supabase/storage-js` (v2.104) : pour un `Blob`, le SDK envoie un
 * `PUT <signedUrl>` avec un `FormData` { cacheControl, '' : fichier } et
 * l'en-tête `x-upsert`. On reproduit exactement ce format (plutôt qu'un
 * corps brut) pour rester sur le chemin que le SDK exerce : storage-api lit
 * alors le MIME depuis la partie multipart, d'où le re-typage du fichier
 * avec `contentType` (le MIME validé côté serveur, qui doit correspondre aux
 * `allowed_mime_types` du bucket). `Content-Type` n'est PAS fixé : le
 * navigateur pose `multipart/form-data; boundary=…`. Aucune clé d'API :
 * le jeton dans l'URL signée suffit (même comportement que le SDK).
 *
 * On passe par XHR (et non `fetch`) uniquement pour la progression
 * d'upload (`xhr.upload.onprogress`).
 */
export interface UploadToSignedUrlInput {
  readonly signedUrl: string;
  readonly file: Blob;
  /** MIME validé (liste blanche) — re-type la partie multipart. */
  readonly contentType: string;
  /** Fraction 0..1. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

const CACHE_CONTROL = '3600';

function abortError(): Error {
  return typeof DOMException === 'function'
    ? new DOMException('Upload aborted', 'AbortError')
    : Object.assign(new Error('Upload aborted'), { name: 'AbortError' });
}

export function uploadToSignedUrl({
  signedUrl,
  file,
  contentType,
  onProgress,
  signal,
}: UploadToSignedUrlInput): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbortSignal = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', onAbortSignal);

    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('Upload failed (network)'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbortSignal);

    const body = new FormData();
    body.append('cacheControl', CACHE_CONTROL);
    // `slice` re-type sans copier les octets.
    body.append('', file.slice(0, file.size, contentType));
    xhr.send(body);
  });
}
