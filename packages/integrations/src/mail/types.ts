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
}
