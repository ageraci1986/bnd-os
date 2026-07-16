export { graphFetch, GraphError } from './client';
export type { GraphFetchOptions } from './client';
export { exchangeCodeForTokens, refreshTokens, GraphAuthError } from './auth';
export type { GraphTokens } from './auth';
export { listInboxInitial, listInboxDelta } from './messages';
export type { InitialSyncResult, DeltaSyncResult } from './messages';
export { parseGraphMessage } from './parse';
export type { ParsedGraphMessage } from './parse';
export { sendViaGraph } from './send';
export type { GraphSendPayload, GraphSendResult } from './send';

export const GRAPH_INTEGRATION_KEY = 'graph' as const;
