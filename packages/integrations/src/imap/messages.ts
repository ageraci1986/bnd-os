import type { ImapFlow, FetchMessageObject } from 'imapflow';
import { parseImapMessage, type RawImapMessage } from './parse';
import type { ParsedMailMessage } from '../mail';

export class UidValidityChangedError extends Error {
  readonly serverUidValidity: bigint;

  constructor(serverUidValidity: bigint) {
    super('IMAP UIDVALIDITY changed since last sync');
    this.name = 'UidValidityChangedError';
    this.serverUidValidity = serverUidValidity;
  }
}

export interface InboxFetchResult {
  readonly messages: readonly ParsedMailMessage[];
  readonly uidValidity: bigint;
  readonly lastSeenUid: bigint;
}

interface InitialArgs {
  readonly session: ImapFlow;
  readonly sinceDays: number;
  readonly maxMessages: number;
}

interface IncrementalArgs {
  readonly session: ImapFlow;
  readonly uidValidity: bigint;
  readonly lastSeenUid: bigint;
}

const INCREMENTAL_CAP = 200;

/**
 * ImapFlow's `download()` resolves with `{ content: Readable }` against a
 * real server. Tests exercise this module against a fake session that
 * returns a plain Buffer instead of a stream, so this helper accepts both
 * shapes rather than assuming one.
 */
async function readAllContent(content: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(content)) return content;
  if (content && typeof (content as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of content as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return Buffer.alloc(0);
}

async function bodyOf(
  session: ImapFlow,
  uid: number,
): Promise<{ text: string | null; html: string | null }> {
  try {
    // { uid: true } is required so the download range is interpreted in UID
    // space (matching the UIDs we track), not IMAP sequence-number space.
    const dl = await session.download(uid, 'TEXT', { uid: true });
    if (!dl?.content) return { text: null, html: null };
    const raw = (await readAllContent(dl.content)).toString('utf8');
    if (!raw) return { text: null, html: null };
    // Heuristic: if it looks like HTML, treat as HTML; else text.
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('<')) return { text: null, html: raw };
    return { text: raw, html: null };
  } catch {
    return { text: null, html: null };
  }
}

function envelopeOf(m: FetchMessageObject): RawImapMessage['envelope'] {
  const env = (m as unknown as { envelope: RawImapMessage['envelope'] }).envelope;
  return {
    date: env.date ?? null,
    subject: env.subject ?? null,
    from: env.from ?? [],
    to: env.to ?? [],
    cc: env.cc ?? [],
    inReplyTo: env.inReplyTo ?? null,
    messageId: env.messageId ?? null,
  };
}

async function toParsedMessage(
  session: ImapFlow,
  m: FetchMessageObject,
): Promise<ParsedMailMessage> {
  const uid = Number((m as { uid: number }).uid);
  const body = await bodyOf(session, uid);
  const internalDate = (m as { internalDate?: Date }).internalDate;
  return parseImapMessage({
    uid,
    envelope: envelopeOf(m),
    flags: new Set((m as { flags?: Set<string> }).flags ?? []),
    bodyText: body.text,
    bodyHtml: body.html,
    ...(internalDate !== undefined ? { internalDate } : {}),
  });
}

export async function listInboxInitial(args: InitialArgs): Promise<InboxFetchResult> {
  const box = await args.session.mailboxOpen('INBOX');
  const since = new Date(Date.now() - args.sinceDays * 24 * 3_600_000);
  const messages: ParsedMailMessage[] = [];
  let maxUid = 0n;
  for await (const m of args.session.fetch(
    { since },
    { envelope: true, flags: true, internalDate: true },
    { uid: true },
  )) {
    if (messages.length >= args.maxMessages) break;
    messages.push(await toParsedMessage(args.session, m));
    const uid = BigInt(Number((m as { uid: number }).uid));
    if (uid > maxUid) maxUid = uid;
  }
  return { messages, uidValidity: box.uidValidity, lastSeenUid: maxUid };
}

export async function listInboxIncremental(args: IncrementalArgs): Promise<InboxFetchResult> {
  const box = await args.session.mailboxOpen('INBOX');
  const serverUidValidity = box.uidValidity;
  if (serverUidValidity !== args.uidValidity) {
    throw new UidValidityChangedError(serverUidValidity);
  }
  const messages: ParsedMailMessage[] = [];
  let maxUid = args.lastSeenUid;
  const range = `${(args.lastSeenUid + 1n).toString()}:*`;
  let count = 0;
  for await (const m of args.session.fetch(
    range,
    { envelope: true, flags: true, internalDate: true },
    { uid: true },
  )) {
    if (count >= INCREMENTAL_CAP) break;
    const uid = BigInt(Number((m as { uid: number }).uid));
    if (uid <= args.lastSeenUid) continue;
    messages.push(await toParsedMessage(args.session, m));
    if (uid > maxUid) maxUid = uid;
    count++;
  }
  return { messages, uidValidity: serverUidValidity, lastSeenUid: maxUid };
}
