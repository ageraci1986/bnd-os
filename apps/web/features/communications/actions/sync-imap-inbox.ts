'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getValidImapCredentials } from '@/features/integrations/lib/get-valid-imap-credentials';
import {
  openImapSession,
  listInboxInitial,
  listInboxIncremental,
  UidValidityChangedError,
} from '@nexushub/integrations/imap';
import type { ParsedMailMessage } from '@nexushub/integrations/mail';
import { buildDomainIndex, matchClientByDomain } from '../lib/auto-associate';

export type SyncImapResult =
  | { readonly ok: true; readonly fetched: number; readonly uidValidityChanged?: boolean }
  | { readonly ok: true; readonly throttled: true }
  | { readonly ok: false; readonly message: string };

const THROTTLE_MS = 30_000;
const INITIAL_DAYS = 30;
const INITIAL_MAX = 200;

export async function syncImapInbox(integrationId: string): Promise<SyncImapResult> {
  const ctx = await requireUser();
  const integration = await prisma.integration.findFirst({
    where: {
      id: integrationId,
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: 'imap',
      status: 'active',
    },
    select: { id: true, imapUidValidity: true, imapLastSeenUid: true, lastSyncedAt: true },
  });
  if (!integration) return { ok: false, message: 'Boîte IMAP introuvable.' };
  if (integration.lastSyncedAt && Date.now() - integration.lastSyncedAt.getTime() < THROTTLE_MS) {
    return { ok: true, throttled: true };
  }

  let creds;
  try {
    creds = await getValidImapCredentials({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      integrationId,
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'creds error' };
  }

  const clients = await prisma.client.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, domains: true },
    orderBy: { createdAt: 'asc' },
  });
  const domainIndex = buildDomainIndex(clients.map((c) => ({ id: c.id, emailDomains: c.domains })));

  let fetched: readonly ParsedMailMessage[] = [];
  let uidValidity = integration.imapUidValidity;
  let lastSeenUid = integration.imapLastSeenUid;
  let uidValidityChanged = false;

  try {
    const session = await openImapSession(creds);
    try {
      if (uidValidity === null || lastSeenUid === null) {
        const r = await listInboxInitial({
          session,
          sinceDays: INITIAL_DAYS,
          maxMessages: INITIAL_MAX,
        });
        fetched = r.messages;
        uidValidity = r.uidValidity;
        lastSeenUid = r.lastSeenUid;
      } else {
        try {
          const r = await listInboxIncremental({ session, uidValidity, lastSeenUid });
          fetched = r.messages;
          uidValidity = r.uidValidity;
          lastSeenUid = r.lastSeenUid;
        } catch (e) {
          if (e instanceof UidValidityChangedError) {
            uidValidityChanged = true;
            const r = await listInboxInitial({
              session,
              sinceDays: INITIAL_DAYS,
              maxMessages: INITIAL_MAX,
            });
            fetched = r.messages;
            uidValidity = r.uidValidity;
            lastSeenUid = r.lastSeenUid;
          } else {
            throw e;
          }
        }
      }
    } finally {
      try {
        await session.logout();
      } catch {
        /* swallow */
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IMAP fetch failed';
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncedAt: new Date(), lastError: message, status: 'error' },
    });
    return { ok: false, message };
  }

  for (const m of fetched) {
    const clientId = matchClientByDomain(m.fromEmail, domainIndex);
    await prisma.emailMessage.upsert({
      where: {
        workspaceId_integrationId_externalId: {
          workspaceId: ctx.workspaceId,
          integrationId: integration.id,
          externalId: m.externalId,
        },
      },
      create: {
        workspaceId: ctx.workspaceId,
        integrationId: integration.id,
        externalId: m.externalId,
        folder: 'inbox',
        subject: m.subject,
        fromEmail: m.fromEmail,
        fromName: m.fromName,
        toRecipients: [...m.toRecipients],
        ccRecipients: [...m.ccRecipients],
        bodyText: m.bodyText,
        bodyHtmlSanitized: m.bodyHtmlSanitized,
        receivedAt: m.receivedAt,
        isRead: m.isRead,
        conversationId: m.conversationId,
        ...(clientId ? { clientId } : {}),
      },
      update: {
        subject: m.subject,
        bodyText: m.bodyText,
        bodyHtmlSanitized: m.bodyHtmlSanitized,
        isRead: m.isRead,
        deletedAt: null,
      },
    });
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      lastSyncedAt: new Date(),
      lastError: null,
      status: 'active',
      imapUidValidity: uidValidity ?? null,
      imapLastSeenUid: lastSeenUid ?? null,
    },
  });
  return {
    ok: true,
    fetched: fetched.length,
    ...(uidValidityChanged ? { uidValidityChanged: true } : {}),
  };
}
