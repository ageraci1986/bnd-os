import type { Transporter } from 'nodemailer';

export interface SmtpSendPayload {
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** RFC 5322 Message-ID of the original mail (for Reply / Forward). */
  readonly inReplyTo?: string;
  /** Threading chain — usually `[inReplyTo]` for a first reply, longer for deeper. */
  readonly references?: readonly string[];
}

export interface SmtpSendResult {
  readonly messageId: string;
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
}

export class SmtpSendError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SmtpSendError';
    this.cause = cause;
  }
}

export async function sendViaSmtp(
  transport: Transporter,
  payload: SmtpSendPayload,
): Promise<SmtpSendResult> {
  try {
    const result = await transport.sendMail({
      from: payload.from,
      to: [...payload.to],
      ...(payload.cc.length > 0 ? { cc: [...payload.cc] } : {}),
      ...(payload.bcc.length > 0 ? { bcc: [...payload.bcc] } : {}),
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      ...(payload.inReplyTo ? { inReplyTo: payload.inReplyTo } : {}),
      ...(payload.references && payload.references.length > 0
        ? { references: [...payload.references] }
        : {}),
    });
    // `Transporter<T = SentMessageInfo>` in @types/nodemailer@8 resolves the
    // default generic to `any` (SentMessageInfo = any) when `Transporter` is
    // imported without an explicit type argument (as required by the "type
    // only" import constraint here). `result` is therefore `any`, so the
    // array element type is annotated explicitly below to avoid an implicit
    // `any` under `strict`.
    const accepted: unknown[] = Array.isArray(result?.accepted) ? result.accepted : [];
    const rejected: unknown[] = Array.isArray(result?.rejected) ? result.rejected : [];
    return {
      messageId: typeof result?.messageId === 'string' ? result.messageId : '',
      accepted: accepted.map((a: unknown) => (typeof a === 'string' ? a : String(a))),
      rejected: rejected.map((a: unknown) => (typeof a === 'string' ? a : String(a))),
    };
  } catch (err) {
    throw new SmtpSendError(err instanceof Error ? err.message : String(err), err);
  }
}
