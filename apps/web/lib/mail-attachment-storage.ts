import 'server-only';
import { createSupabaseAdmin } from '@/lib/supabase/server';

const BUCKET = 'mail-attachments';
const SIGNED_URL_TTL_SECONDS = 300;

interface UploadArgs {
  readonly workspaceId: string;
  readonly attachmentId: string;
  readonly contentType: string;
  readonly binary: Buffer;
}

export type UploadResult =
  | { readonly ok: true; readonly storagePath: string }
  | { readonly ok: false; readonly message: string };

export async function uploadMailAttachment(args: UploadArgs): Promise<UploadResult> {
  const path = `${args.workspaceId}/${args.attachmentId}`;
  const { data, error } = await createSupabaseAdmin()
    .storage.from(BUCKET)
    .upload(path, args.binary, { contentType: args.contentType, upsert: false });
  if (error || !data) return { ok: false, message: error?.message ?? 'Upload failed' };
  return { ok: true, storagePath: data.path };
}

export type SignedUrlResult =
  | { readonly ok: true; readonly signedUrl: string }
  | { readonly ok: false; readonly message: string };

export async function getMailAttachmentSignedUrl(storagePath: string): Promise<SignedUrlResult> {
  const { data, error } = await createSupabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return { ok: false, message: error?.message ?? 'Sign failed' };
  return { ok: true, signedUrl: data.signedUrl };
}

/**
 * Best-effort delete. Failures are swallowed — callers must not roll back on
 * a delete failure (e.g. draft discard flow).
 */
export async function deleteMailAttachment(storagePath: string): Promise<void> {
  try {
    await createSupabaseAdmin().storage.from(BUCKET).remove([storagePath]);
  } catch {
    /* swallow */
  }
}
