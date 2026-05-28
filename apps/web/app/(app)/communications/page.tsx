import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getClientFilterFromSearchParams, resolveActiveClient } from '@/lib/client-filter/server';
import { syncGraphInbox } from '@/features/communications/actions/sync-graph-inbox';
import { toMailDTO } from '@/features/communications/lib/mail-dto';
import { EmptyNoIntegration } from '@/features/communications/components/empty-no-integration';
import { MailTabs } from '@/features/communications/components/mail-tabs';
import { MailList } from '@/features/communications/components/mail-list';

export const metadata: Metadata = { title: 'Communications' };

interface PageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const SYNC_FRESHNESS_MS = 30_000;

export default async function CommunicationsPage({ searchParams }: PageProps) {
  const ctx = await requireUser();
  const sp = (await searchParams) ?? {};

  const integration = await prisma.integration.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      kind: 'graph',
      ownerUserId: ctx.userId,
    },
    select: { status: true, lastSyncedAt: true },
  });

  if (!integration || (integration.status !== 'active' && integration.status !== 'error')) {
    return (
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-6">
          <h1 className="text-[28px] font-extrabold tracking-tight">Communications</h1>
        </header>
        <EmptyNoIntegration />
      </div>
    );
  }

  if (
    integration.status === 'active' &&
    (!integration.lastSyncedAt ||
      Date.now() - integration.lastSyncedAt.getTime() > SYNC_FRESHNESS_MS)
  ) {
    await syncGraphInbox();
  }

  const filter = getClientFilterFromSearchParams(sp);
  const activeClient = await resolveActiveClient(filter, ctx.workspaceId);
  const clientFilter = activeClient?.id ?? null;

  const rows = await prisma.emailMessage.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...(clientFilter ? { clientId: clientFilter } : {}),
    },
    select: {
      id: true,
      subject: true,
      fromEmail: true,
      fromName: true,
      bodyText: true,
      bodyHtmlSanitized: true,
      receivedAt: true,
      isRead: true,
      clientId: true,
      client: { select: { id: true, name: true, colorToken: true } },
      toRecipients: true,
      ccRecipients: true,
    },
    orderBy: { receivedAt: 'desc' },
    take: 200,
  });
  const mails = rows.map(toMailDTO);
  const unreadCount = rows.filter((r) => !r.isRead).length;
  const refreshedIntegration = await prisma.integration.findFirst({
    where: { workspaceId: ctx.workspaceId, kind: 'graph', ownerUserId: ctx.userId },
    select: { lastSyncedAt: true },
  });

  return (
    <div className="mx-auto max-w-[1200px]">
      <header className="mb-4">
        <h1 className="text-[28px] font-extrabold tracking-tight">Communications</h1>
      </header>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)]">
        <MailTabs
          lastSyncedAt={
            refreshedIntegration?.lastSyncedAt
              ? refreshedIntegration.lastSyncedAt.toISOString()
              : null
          }
          totalCount={mails.length}
          unreadCount={unreadCount}
        />
        {mails.length === 0 ? (
          <div className="p-10 text-center text-sm text-[color:var(--color-text-muted)]">
            Aucun mail à afficher pour l&apos;instant.
          </div>
        ) : (
          <MailList mails={mails} />
        )}
      </div>
    </div>
  );
}
