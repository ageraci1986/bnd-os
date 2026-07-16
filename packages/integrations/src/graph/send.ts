import { graphFetch } from './client';

const GRAPH = 'https://graph.microsoft.com/v1.0';

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
  if (payload.inReplyToMessageId && payload.mode) {
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
      },
      saveToSentItems: true,
    }),
  });
  return { ok: true };
}
