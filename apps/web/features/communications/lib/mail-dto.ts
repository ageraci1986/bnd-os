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
  };
}>;

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
  };
}
