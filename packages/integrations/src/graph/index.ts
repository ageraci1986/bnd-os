// Microsoft Graph adapter skeleton — implemented in Phase 6.2.
// Responsibilities:
// - OAuth délégué (per-user mailbox connection)
// - Subscriptions notifications (validationToken + clientState)
// - Mail read / sendMail wrappers
// - Auto-association email → client by domain rules
export const GRAPH_INTEGRATION_KEY = 'graph' as const;
