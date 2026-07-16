import { graphFetch } from './client';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Total payload cap for POST /me/sendMail (Microsoft docs: ~4 MB hard limit
 * on the whole request; we cap attachment bytes at 3 MB to leave headroom
 * for the JSON envelope, headers, and base64 inflation). Larger attachments
 * require the resumable upload-session flow, which V1.5 does not implement.
 */
const GRAPH_ATTACHMENT_LIMIT_BYTES = 3_000_000;

export interface GraphAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Buffer;
}

export class GraphPayloadTooLargeError extends Error {
  override readonly cause?: unknown;

  constructor(totalBytes: number, cause?: unknown) {
    super(
      `Graph attachments payload too large: ${totalBytes} bytes (max ${GRAPH_ATTACHMENT_LIMIT_BYTES})`,
    );
    this.name = 'GraphPayloadTooLargeError';
    this.cause = cause;
  }
}

/**
 * Graph's /reply, /replyAll, /forward endpoints do not accept attachments in
 * their payload — the only way to attach binaries there is the V2 draft flow
 * (createReply/createForward, POST /attachments, then send). V1.5 rejects
 * instead of silently dropping the attachment; the orchestrator surfaces
 * this as a UI error suggesting "New" mode.
 */
export class GraphReplyAttachmentsUnsupportedError extends Error {
  constructor() {
    super(
      'Attachments are not supported when replying or forwarding via Graph in V1.5. Compose a new mail instead.',
    );
    this.name = 'GraphReplyAttachmentsUnsupportedError';
  }
}

export interface GraphSendPayload {
  readonly subject: string;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bccRecipients: readonly string[];
  readonly bodyHtmlSanitized: string;
  /** Set for Reply / Forward — the id of the original Graph message. */
  readonly inReplyToMessageId?: string;
  /** When inReplyToMessageId is set, distinguishes /reply, /replyAll, /forward. Ignored otherwise. */
  readonly mode?: 'reply' | 'reply_all' | 'forward';
  /**
   * Binaries already resolved in memory. Only supported on the /sendMail
   * (new mail) path — see GraphReplyAttachmentsUnsupportedError.
   */
  readonly attachments?: readonly GraphAttachment[];
}

export interface GraphSendResult {
  readonly ok: true;
}

function toRecipientsPayload(addrs: readonly string[]): { emailAddress: { address: string } }[] {
  return addrs.map((a) => ({ emailAddress: { address: a } }));
}

/**
 * Send a mail via Microsoft Graph. Uses:
 *  - POST /me/messages/{id}/reply (or /replyAll or /forward) when inReplyToMessageId is set:
 *    Graph handles threading + quote of original server-side. Payload = { comment, message: {…} }
 *  - POST /me/sendMail for a new mail: full message payload with saveToSentItems=true.
 *
 * Graph returns 202 Accepted with no body on success (handled by graphFetch).
 */
export async function sendViaGraph(
  token: string,
  payload: GraphSendPayload,
): Promise<GraphSendResult> {
  const attachments = payload.attachments ?? [];
  const hasAttachments = attachments.length > 0;

  if (payload.inReplyToMessageId && payload.mode) {
    if (hasAttachments) {
      throw new GraphReplyAttachmentsUnsupportedError();
    }
    const endpoint =
      payload.mode === 'forward' ? 'forward' : payload.mode === 'reply_all' ? 'replyAll' : 'reply';
    await graphFetch(
      `${GRAPH}/me/messages/${encodeURIComponent(payload.inReplyToMessageId)}/${endpoint}`,
      {
        token,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({
          comment: payload.bodyHtmlSanitized,
          message: {
            toRecipients: toRecipientsPayload(payload.toRecipients),
            ccRecipients: toRecipientsPayload(payload.ccRecipients),
            bccRecipients: toRecipientsPayload(payload.bccRecipients),
          },
        }),
      },
    );
    return { ok: true };
  }

  if (hasAttachments) {
    const totalBytes = attachments.reduce((sum, a) => sum + a.content.byteLength, 0);
    if (totalBytes > GRAPH_ATTACHMENT_LIMIT_BYTES) {
      throw new GraphPayloadTooLargeError(totalBytes);
    }
  }

  await graphFetch(`${GRAPH}/me/sendMail`, {
    token,
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({
      message: {
        subject: payload.subject,
        body: { contentType: 'HTML', content: payload.bodyHtmlSanitized },
        toRecipients: toRecipientsPayload(payload.toRecipients),
        ccRecipients: toRecipientsPayload(payload.ccRecipients),
        bccRecipients: toRecipientsPayload(payload.bccRecipients),
        ...(hasAttachments
          ? {
              attachments: attachments.map((a) => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: a.filename,
                contentType: a.contentType,
                contentBytes: a.content.toString('base64'),
              })),
            }
          : {}),
      },
      saveToSentItems: true,
    }),
  });
  return { ok: true };
}
