import 'server-only';
import { createSupabaseAdmin } from '@/lib/supabase/server';

/**
 * Bucket privé des pièces jointes de cartes (spec lot C §1). Service role
 * uniquement ; le client n'obtient qu'un jeton d'upload à usage unique lié
 * au chemin, ou une URL de lecture signée de 300 s pour une PJ `clean`.
 * Ne jamais renvoyer `message` d'erreur au client (infos d'infra).
 */
export const CARD_ATTACHMENTS_BUCKET = 'card-attachments';
const READ_TTL_SECONDS = 300;

export function cardAttachmentPath(
  workspaceId: string,
  cardId: string,
  attachmentId: string,
): string {
  return `${workspaceId}/${cardId}/${attachmentId}`;
}

interface Fail {
  readonly ok: false;
  readonly message: string;
}

export async function createCardAttachmentUploadUrl(
  path: string,
): Promise<
  | { readonly ok: true; readonly signedUrl: string; readonly token: string; readonly path: string }
  | Fail
> {
  const { data, error } = await createSupabaseAdmin()
    .storage.from(CARD_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: error?.message ?? 'Sign upload failed' };
  return { ok: true, signedUrl: data.signedUrl, token: data.token, path: data.path };
}

export async function getCardAttachmentSignedUrl(
  path: string,
  opts: { readonly download?: string },
): Promise<{ readonly ok: true; readonly signedUrl: string } | Fail> {
  const { data, error } = await createSupabaseAdmin()
    .storage.from(CARD_ATTACHMENTS_BUCKET)
    .createSignedUrl(
      path,
      READ_TTL_SECONDS,
      opts.download ? { download: opts.download } : undefined,
    );
  if (error || !data) return { ok: false, message: error?.message ?? 'Sign failed' };
  return { ok: true, signedUrl: data.signedUrl };
}

export async function downloadCardAttachment(
  path: string,
): Promise<{ readonly ok: true; readonly binary: Buffer } | Fail> {
  const { data, error } = await createSupabaseAdmin()
    .storage.from(CARD_ATTACHMENTS_BUCKET)
    .download(path);
  if (error || !data) return { ok: false, message: error?.message ?? 'Download failed' };
  return { ok: true, binary: Buffer.from(await data.arrayBuffer()) };
}

export async function removeCardAttachment(path: string): Promise<void> {
  try {
    await createSupabaseAdmin().storage.from(CARD_ATTACHMENTS_BUCKET).remove([path]);
  } catch {
    /* best-effort */
  }
}
