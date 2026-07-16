/**
 * Uniform attachment metadata shape produced by every inbound-mail adapter
 * (Graph, IMAP, …) at parse-time — no binary, no Storage/scan state yet.
 * `sourceExternalId` is the adapter-specific reference used to re-fetch the
 * binary later (IMAP part number, Graph attachment id).
 */
export interface ParsedMailAttachmentMeta {
  readonly sourceExternalId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly contentId: string | null;
  readonly isInline: boolean;
}

/**
 * Uniform shape produced by every inbound-mail adapter (Graph, IMAP, …).
 * Consumers of the Communications sync path only depend on this type.
 */
export interface ParsedMailMessage {
  readonly externalId: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly receivedAt: Date;
  readonly isRead: boolean;
  readonly conversationId: string | null;
  readonly bodyText: string;
  readonly bodyHtmlSanitized: string | null;
  /** Undefined = adapter didn't populate attachments for this fetch. */
  readonly attachments?: readonly ParsedMailAttachmentMeta[];
}
