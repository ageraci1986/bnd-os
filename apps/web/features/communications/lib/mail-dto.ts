import type { Prisma } from '@nexushub/db';

export type EmailMessageListRow = Prisma.EmailMessageGetPayload<{
  select: {
    id: true;
    subject: true;
    fromEmail: true;
    fromName: true;
    bodyText: true;
    bodyHtmlSanitized: true;
    receivedAt: true;
    isRead: true;
    clientId: true;
    client: { select: { id: true; name: true; colorToken: true } };
    toRecipients: true;
    ccRecipients: true;
    integration: { select: { externalAccountLabel: true } };
    externalId: true;
    integrationId: true;
    sendStatus: true;
    sendError: true;
    hasAttachments: true;
    emailAttachments: {
      where: { isInline: false };
      select: {
        id: true;
        filename: true;
        contentType: true;
        sizeBytes: true;
        scanStatus: true;
      };
      orderBy: { createdAt: 'asc' };
    };
  };
}>;

/**
 * Client-facing shape of a persisted attachment (Task 20, Communications
 * iter V1.5). Deliberately narrower than the Prisma row — `sha256`,
 * `storagePath` and `scanReport` are server-only (dedup key, Storage
 * internals, antivirus engine details) and must never reach the browser
 * (CLAUDE.md §4.7 — no infra/PII leakage in client payloads).
 */
export interface MailAttachmentDto {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly scanStatus: 'pending' | 'clean' | 'dirty' | 'scan_failed' | null;
}

export interface MailDTO {
  readonly id: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly preview: string;
  readonly receivedAt: string;
  readonly isRead: boolean;
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly colorToken: string;
  } | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bodyHtmlSanitized: string | null;
  readonly bodyText: string;
  readonly mailboxLabel: string | null;
  readonly externalId: string;
  readonly integrationId: string;
  readonly sendStatus: 'queued' | 'sending' | 'sent' | 'failed' | null;
  readonly sendError: string | null;
  readonly hasAttachments: boolean;
  readonly attachments: readonly MailAttachmentDto[];
}

const PREVIEW_LEN = 140;

export function toMailDTO(row: EmailMessageListRow): MailDTO {
  const bodyText = row.bodyText ?? '';
  return {
    id: row.id,
    subject: row.subject,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    preview: bodyText.slice(0, PREVIEW_LEN),
    receivedAt: row.receivedAt.toISOString(),
    isRead: row.isRead,
    client: row.client
      ? { id: row.client.id, name: row.client.name, colorToken: row.client.colorToken }
      : null,
    toRecipients: row.toRecipients,
    ccRecipients: row.ccRecipients,
    bodyHtmlSanitized: row.bodyHtmlSanitized,
    bodyText,
    mailboxLabel: row.integration?.externalAccountLabel ?? null,
    externalId: row.externalId,
    integrationId: row.integrationId,
    sendStatus: row.sendStatus,
    sendError: row.sendError,
    hasAttachments: row.hasAttachments,
    attachments: row.emailAttachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      scanStatus: a.scanStatus,
    })),
  };
}
