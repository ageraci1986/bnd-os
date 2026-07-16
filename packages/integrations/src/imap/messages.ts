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

function toParsedMessage(m: FetchMessageObject): ParsedMailMessage {
  // V1: envelope-only. Downloading each message body via `session.download`
  // is a separate IMAP round-trip per UID — 200 sequential downloads blow
  // past Vercel's serverless timeout on the initial sync. Bodies will be
  // lazy-fetched on demand when the user opens a mail (V1.5 task).
  const uid = Number((m as { uid: number }).uid);
  const internalDate = (m as { internalDate?: Date }).internalDate;
  return parseImapMessage({
    uid,
    envelope: envelopeOf(m),
    flags: new Set((m as { flags?: Set<string> }).flags ?? []),
    bodyText: null,
    bodyHtml: null,
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
    messages.push(toParsedMessage(m));
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
    messages.push(toParsedMessage(m));
    if (uid > maxUid) maxUid = uid;
    count++;
  }
  return { messages, uidValidity: serverUidValidity, lastSeenUid: maxUid };
}
