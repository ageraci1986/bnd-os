import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SmtpCredentials {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS (port 465). Mutually exclusive with `requireTls`. */
  readonly secure: boolean;
  /** STARTTLS on port 587. Overrides insecure when true. */
  readonly requireTls?: boolean;
  readonly username: string;
  readonly password: string;
}

export class SmtpConnectionError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SmtpConnectionError';
    this.cause = cause;
  }
}

const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Open a connected SMTP transporter. Caller MUST call `transport.close()`
 * in a try/finally — this module intentionally does not own the lifecycle
 * beyond `verify()`.
 */
export async function openSmtpTransport(creds: SmtpCredentials): Promise<Transporter> {
  const transport = nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    requireTLS: creds.requireTls ?? false,
    auth: { user: creds.username, pass: creds.password },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: CONNECT_TIMEOUT_MS,
    // No connection pooling — matches the per-op IMAP session pattern; the
    // outbox flow opens+closes transports per send. `pool` is omitted (not
    // set to `true`) rather than passed as `false`: SMTPTransport.Options
    // (the @types/nodemailer overload matched here) does not declare a
    // `pool` key at all — that key only exists on SMTPPool.Options — so
    // including it would fail TS's excess-property check on this overload.
    // Single-shot (non-pooled) transport is nodemailer's default behavior
    // when `pool: true` is not set.
    // Silence nodemailer's own logger — CLAUDE.md §4.7 forbids PII in logs.
    logger: false,
  });
  try {
    await transport.verify();
    return transport;
  } catch (err) {
    try {
      transport.close();
    } catch {
      /* swallow */
    }
    throw new SmtpConnectionError('SMTP connect failed', err);
  }
}
