'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getValidAccessToken } from '@/features/integrations/lib/get-valid-access-token';
import {
  listInboxInitial,
  listInboxDelta,
  listGraphAttachments,
  type ParsedGraphMessage,
} from '@nexushub/integrations/graph';
import { buildDomainIndex, matchClientByDomain } from '../lib/auto-associate';

export type SyncResult =
  | { readonly ok: true; readonly fetched: number; readonly removed: number }
  | { readonly ok: true; readonly throttled: true }
  | { readonly ok: false; readonly message: string };

const THROTTLE_MS = 30_000;
const INITIAL_DAYS = 30;
const INITIAL_MAX = 200;

export async function syncGraphInbox(): Promise<SyncResult> {
  const ctx = await requireUser();
  const integration = await prisma.integration.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      kind: 'graph',
      ownerUserId: ctx.userId,
      status: 'active',
    },
    select: { id: true, deltaToken: true, lastSyncedAt: true },
  });
  if (!integration) {
    return { ok: false, message: 'Aucune boîte connectée.' };
  }
  if (integration.lastSyncedAt && Date.now() - integration.lastSyncedAt.getTime() < THROTTLE_MS) {
    return { ok: true, throttled: true };
  }

  let token: string;
  try {
    token = await getValidAccessToken(integration.id);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Refresh failed' };
  }

  const clients = await prisma.client.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, domains: true },
    orderBy: { createdAt: 'asc' },
  });
  const domainIndex = buildDomainIndex(clients.map((c) => ({ id: c.id, emailDomains: c.domains })));

  let fetched: readonly ParsedGraphMessage[];
  let removed: readonly string[] = [];
  let deltaLink: string | null;

  // Bump `lastSyncedAt` on *both* success and failure paths. The
  // /communications page re-triggers a sync whenever `lastSyncedAt < now-30s`,
  // so a broken sync would loop on every render if we only updated on success.
  // The 30s throttle is the only guard against retry storms.
  try {
    if (integration.deltaToken) {
      const res = await listInboxDelta({ token, deltaUrl: integration.deltaToken });
      fetched = res.messages;
      removed = res.removedIds;
      deltaLink = res.deltaLink;
    } else {
      const res = await listInboxInitial({
        token,
        sinceDays: INITIAL_DAYS,
        maxMessages: INITIAL_MAX,
      });
      fetched = res.messages;
      deltaLink = res.deltaLink;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Graph fetch failed';
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncedAt: new Date(), lastError: message },
    });
    return { ok: false, message };
  }

  for (const m of fetched) {
    const clientId = matchClientByDomain(m.fromEmail, domainIndex);
    const emailMessageRow = await prisma.emailMessage.upsert({
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

    // Graph exposes `hasAttachments` natively on the message list response,
    // but never the attachment bytes/metadata themselves — a follow-up call
    // is always required. Attachment binaries are never fetched during sync
    // (would blow the serverless timeout) — only metadata persisted here.
    // The binary is lazy-fetched from source on first user download demand.
    if (m.hasAttachments) {
      const attachments = await listGraphAttachments(token, m.externalId);
      if (attachments.length > 0) {
        await prisma.emailMessage.update({
          where: { id: emailMessageRow.id },
          data: { hasAttachments: true },
        });
        for (const att of attachments) {
          await prisma.emailAttachment.upsert({
            where: {
              emailMessageId_sourceExternalId: {
                emailMessageId: emailMessageRow.id,
                sourceExternalId: att.id,
              },
            },
            create: {
              workspaceId: ctx.workspaceId,
              emailMessageId: emailMessageRow.id,
              filename: att.filename,
              contentType: att.contentType,
              sizeBytes: att.sizeBytes,
              sourceExternalId: att.id,
              ...(att.contentId ? { contentId: att.contentId } : {}),
              isInline: att.isInline,
              storagePath: null,
              scanStatus: null,
            },
            update: {
              filename: att.filename,
              contentType: att.contentType,
              sizeBytes: att.sizeBytes,
              ...(att.contentId ? { contentId: att.contentId } : { contentId: null }),
              isInline: att.isInline,
            },
          });
        }
      }
    }
  }

  if (removed.length > 0) {
    await prisma.emailMessage.updateMany({
      where: {
        workspaceId: ctx.workspaceId,
        integrationId: integration.id,
        externalId: { in: [...removed] },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      lastSyncedAt: new Date(),
      ...(deltaLink ? { deltaToken: deltaLink } : {}),
    },
  });

  return { ok: true, fetched: fetched.length, removed: removed.length };
}
