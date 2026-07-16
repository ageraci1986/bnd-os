import { ImapFlow } from 'imapflow';

export interface ImapCredentials {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
}

export class ImapConnectionError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ImapConnectionError';
    this.cause = cause;
  }
}

const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Open a connected ImapFlow session. Caller MUST wrap usage in a try/finally
 * that calls `session.logout()` — this module intentionally does not own the
 * session lifecycle beyond initial connect.
 */
export async function openImapSession(creds: ImapCredentials): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.username, pass: creds.password },
    logger: false,
    disableAutoIdle: true,
    // ImapFlow honors this as the whole handshake budget
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
  });
  try {
    await client.connect();
    return client;
  } catch (err) {
    throw new ImapConnectionError('IMAP connect failed', err);
  }
}
