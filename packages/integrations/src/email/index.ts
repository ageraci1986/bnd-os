/**
 * Email adapter (CLAUDE.md §2 — Resend).
 *
 * SECURITY:
 *  - Never log full email body or sensitive params (token, password reset link).
 *  - In dev, when RESEND_API_KEY is absent, the adapter logs a *redacted*
 *    preview to the console so the dev can pick up the link without exposing
 *    secrets in shared env logs (CI, Sentry, etc.).
 *  - All sends happen server-side. Never call from a 'use client' module.
 */
import 'server-only';
import { Resend } from 'resend';

export const EMAIL_INTEGRATION_KEY = 'resend' as const;

export interface SendEmailParams {
  /** Single recipient. */
  readonly to: string;
  /** Optional reply-to. */
  readonly replyTo?: string;
  /** RFC 5322 subject (≤ 988 chars). */
  readonly subject: string;
  /** Plain text body. Markdown is OK; we never inject raw HTML. */
  readonly text: string;
  /** Optional sanitized HTML alternative. Caller is responsible for sanitization. */
  readonly htmlSanitized?: string;
  /** Tag for analytics (e.g. "invitation", "password-reset"). */
  readonly tag: 'invitation' | 'password_reset' | 'notification';
}

export interface EmailResult {
  readonly id: string | null;
  readonly delivered: boolean;
}

interface EmailAdapterConfig {
  readonly apiKey?: string | undefined;
  readonly fromEmail: string;
  readonly fromName?: string | undefined;
  /** When true, never throw on missing api key; log to console. Defaults to NODE_ENV !== 'production'. */
  readonly devFallback?: boolean | undefined;
}

const REDACTED = '«redacted»';

function redactPreview(text: string): string {
  // Minimal preview for dev console: first 80 chars, no urls, no tokens.
  const noUrls = text.replace(/https?:\/\/\S+/g, REDACTED);
  return noUrls.slice(0, 80).replace(/\s+/g, ' ').trim();
}

/**
 * Returns a configured email sender. The factory pattern keeps the module
 * pure: the Resend client is only instantiated when a key is provided.
 */
export function createEmailAdapter(config: EmailAdapterConfig) {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const allowDevFallback = config.devFallback ?? !isProduction;
  const hasKey = typeof config.apiKey === 'string' && config.apiKey.length > 0;

  if (!hasKey && !allowDevFallback) {
    throw new Error('Email adapter: missing RESEND_API_KEY and dev fallback disabled.');
  }

  const client = hasKey ? new Resend(config.apiKey) : null;

  return {
    async send(params: SendEmailParams): Promise<EmailResult> {
      const from = config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail;

      if (!client) {
        // Dev fallback: print metadata only. NEVER print full text — it may
        // contain magic links or invitation tokens.
        console.warn(
          `[email:dev] would send to=${params.to} tag=${params.tag} ` +
            `subject="${params.subject}" preview="${redactPreview(params.text)}"`,
        );
        return { id: null, delivered: false };
      }

      const result = await client.emails.send({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        ...(params.htmlSanitized !== undefined ? { html: params.htmlSanitized } : {}),
        ...(params.replyTo !== undefined ? { replyTo: params.replyTo } : {}),
        tags: [{ name: 'kind', value: params.tag }],
      });

      if (result.error) {
        // We surface a generic message; full error is logged for ops.
        console.error('[email] send failed', {
          tag: params.tag,
          to: params.to,
          from,
          name: result.error.name,
          message: result.error.message,
        });
        throw new Error('EMAIL_SEND_FAILED');
      }

      // Always log success in dev so we can trace the Resend message id.
      // SECURITY: we log the message id (safe, public-facing) but never the body.
      console.warn(
        `[email] sent id=${result.data?.id ?? 'unknown'} to=${params.to} tag=${params.tag} from=${from}`,
      );
      return { id: result.data?.id ?? null, delivered: true };
    },
  };
}

export type EmailAdapter = ReturnType<typeof createEmailAdapter>;
