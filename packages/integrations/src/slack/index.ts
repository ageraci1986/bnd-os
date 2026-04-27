// Slack adapter skeleton — implemented in Phase 6.1.
// Responsibilities:
// - OAuth flow (state HMAC + Redis nonce)
// - Token storage (encrypted via @nexushub/domain/crypto)
// - Webhook signature verification (X-Slack-Signature + timestamp)
// - chat.postMessage / events.history wrappers
//
// SECURITY:
// - The signing secret is read from env (SLACK_SIGNING_SECRET) and never returned.
// - Tokens are decrypted only inside server actions, never logged.
export const SLACK_INTEGRATION_KEY = 'slack' as const;
