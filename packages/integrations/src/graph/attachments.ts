import { graphFetch } from './client';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface ParsedGraphAttachment {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly contentId: string | null;
  readonly isInline: boolean;
}

interface RawAttachment {
  readonly '@odata.type'?: string;
  readonly id?: string;
  readonly name?: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly contentId?: string | null;
  readonly isInline?: boolean;
}

interface GraphAttachmentListResponse {
  readonly value?: readonly RawAttachment[];
}

/**
 * Lists the attachments of a Graph message, keeping only `fileAttachment`
 * entries — `itemAttachment` (nested message) and `referenceAttachment`
 * (OneDrive/SharePoint link) are out of scope for V1.5.
 */
export async function listGraphAttachments(
  token: string,
  messageId: string,
): Promise<readonly ParsedGraphAttachment[]> {
  const res = await graphFetch<GraphAttachmentListResponse>(
    `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments`,
    { token },
  );
  const list = res.value ?? [];
  return list
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment')
    .map((a) => ({
      id: a.id ?? '',
      filename: a.name ?? 'attachment.bin',
      contentType: a.contentType ?? 'application/octet-stream',
      sizeBytes: a.size ?? 0,
      contentId: a.contentId ?? null,
      isInline: a.isInline ?? false,
    }));
}

/** Downloads the raw bytes of a single file attachment via the `$value` endpoint. */
export async function fetchGraphAttachmentBinary(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  const buf = await graphFetch<Buffer>(
    `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
    { token, raw: true },
  );
  return Buffer.isBuffer(buf) ? buf : null;
}
