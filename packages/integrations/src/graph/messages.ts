import { graphFetch } from './client';
import { parseGraphMessage, type ParsedGraphMessage } from './parse';

const GRAPH = 'https://graph.microsoft.com/v1.0';

const SELECT_FIELDS = [
  'id',
  'subject',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'isRead',
  'conversationId',
  'bodyPreview',
  'body',
].join(',');

interface GraphListResponse {
  value: unknown[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface InitialSyncResult {
  readonly messages: readonly ParsedGraphMessage[];
  readonly deltaLink: string | null;
}

export async function listInboxInitial(params: {
  readonly token: string;
  readonly sinceDays: number;
  readonly maxMessages: number;
}): Promise<InitialSyncResult> {
  const sinceIso = new Date(Date.now() - params.sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL(`${GRAPH}/me/mailFolders/inbox/messages/delta`);
  url.searchParams.set('$select', SELECT_FIELDS);
  url.searchParams.set('$top', '50');
  url.searchParams.set('$filter', `receivedDateTime ge ${sinceIso}`);
  return paginate(url.toString(), params.token, params.maxMessages);
}

export interface DeltaSyncResult {
  readonly messages: readonly ParsedGraphMessage[];
  readonly removedIds: readonly string[];
  readonly deltaLink: string | null;
}

export async function listInboxDelta(params: {
  readonly token: string;
  readonly deltaUrl: string;
}): Promise<DeltaSyncResult> {
  let url = params.deltaUrl;
  const messages: ParsedGraphMessage[] = [];
  const removedIds: string[] = [];
  let deltaLink: string | null = null;
  for (;;) {
    const page = await graphFetch<GraphListResponse>(url, { token: params.token });
    for (const item of page.value) {
      const r = item as { id?: string; '@removed'?: unknown };
      if (r['@removed']) {
        if (typeof r.id === 'string') removedIds.push(r.id);
      } else {
        messages.push(parseGraphMessage(item as Parameters<typeof parseGraphMessage>[0]));
      }
    }
    if (page['@odata.nextLink']) {
      url = page['@odata.nextLink'];
      continue;
    }
    deltaLink = page['@odata.deltaLink'] ?? null;
    break;
  }
  return { messages, removedIds, deltaLink };
}

async function paginate(
  startUrl: string,
  token: string,
  maxMessages: number,
): Promise<InitialSyncResult> {
  let url = startUrl;
  const messages: ParsedGraphMessage[] = [];
  let deltaLink: string | null = null;
  for (;;) {
    const page = await graphFetch<GraphListResponse>(url, { token });
    for (const item of page.value) {
      if (messages.length >= maxMessages) break;
      messages.push(parseGraphMessage(item as Parameters<typeof parseGraphMessage>[0]));
    }
    if (messages.length >= maxMessages) break;
    if (page['@odata.nextLink']) {
      url = page['@odata.nextLink'];
      continue;
    }
    deltaLink = page['@odata.deltaLink'] ?? null;
    break;
  }
  return { messages, deltaLink };
}
