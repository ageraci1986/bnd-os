export { openSmtpTransport, SmtpConnectionError } from './client';
export type { SmtpCredentials } from './client';
export { sendViaSmtp, SmtpSendError } from './send';
export type { SmtpSendPayload, SmtpSendResult } from './send';
export { appendToSentFolder } from './imap-append';
export { testSmtpConnection } from './connection-test';
export type { SmtpConnectionTestResult } from './connection-test';
