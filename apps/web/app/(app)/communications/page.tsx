import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import {
  getClientFilterFromSearchParams,
  readSearchParamString,
  resolveActiveClient,
} from '@/lib/client-filter/server';
import { syncGraphInbox } from '@/features/communications/actions/sync-graph-inbox';
import { syncImapInbox } from '@/features/communications/actions/sync-imap-inbox';
import { toMailDTO } from '@/features/communications/lib/mail-dto';
import { EmptyNoIntegration } from '@/features/communications/components/empty-no-integration';
import { MailTabs } from '@/features/communications/components/mail-tabs';
import { MailList } from '@/features/communications/components/mail-list';
import { MailboxFilter } from '@/features/communications/components/mailbox-filter';
import { MailPagination } from '@/features/communications/components/mail-pagination';

export const metadata: Metadata = { title: 'Communications' };

interface PageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const SYNC_FRESHNESS_MS = 30_000;
const PAGE_SIZE = 50;

export default async function CommunicationsPage({ searchParams }: PageProps) {
  const ctx = await requireUser();
  const sp = (await searchParams) ?? {};

  // Any active/error mailbox (Graph or IMAP) is enough to leave the empty
  // state — a mailbox that failed its last sync still has messages worth
  // showing, so `error` counts alongside `active`.
  const mailboxCount = await prisma.integration.count({
    where: {
      workspaceId: ctx.workspaceId,
      kind: { in: ['graph', 'imap'] },
      ownerUserId: ctx.userId,
      status: { in: ['active', 'error'] },
    },
  });

  if (mailboxCount === 0) {
    return (
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-6">
          <h1 className="text-[28px] font-extrabold tracking-tight">Communications</h1>
        </header>
        <EmptyNoIntegration />
      </div>
    );
  }

  // Sync every active mailbox in parallel. `allSettled` (not `all`) ensures a
  // broken IMAP connection never stalls a working Graph sync, or vice versa —
  // each sync action already records its own failure on the integration row.
  const activeMailboxes = await prisma.integration.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: { in: ['graph', 'imap'] },
      status: 'active',
    },
    select: { id: true, kind: true, lastSyncedAt: true },
  });
  await Promise.allSettled(
    activeMailboxes
      .filter((m) => !m.lastSyncedAt || Date.now() - m.lastSyncedAt.getTime() > SYNC_FRESHNESS_MS)
      .map((m) => (m.kind === 'graph' ? syncGraphInbox() : syncImapInbox(m.id))),
  );

  const filter = getClientFilterFromSearchParams(sp);
  const activeClient = await resolveActiveClient(filter, ctx.workspaceId);
  const clientFilter = activeClient?.id ?? null;

  // `?mailbox=<integrationId>` narrows the list to a single connected
  // mailbox. Options are scoped to the user's own mailboxes (Graph/IMAP are
  // both delegated per-user, PRD §9 hypothesis 8), same scoping as the
  // sync queries above, ordered by connection date for a stable dropdown.
  const mailboxParam = readSearchParamString(sp['mailbox']);
  const mailboxOptionRows = await prisma.integration.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: { in: ['graph', 'imap'] },
      status: { in: ['active', 'error'] },
    },
    select: { id: true, externalAccountLabel: true },
    orderBy: { createdAt: 'asc' },
  });
  const mailboxOptions = mailboxOptionRows.map((m) => ({
    id: m.id,
    label: m.externalAccountLabel ?? m.id,
  }));
  const mailboxFilter = mailboxOptions.some((o) => o.id === mailboxParam) ? mailboxParam : null;

  // URL-driven pagination: ?page=N (1-based). Composes with client + mailbox
  // filters — MailPagination preserves the other query params on nav.
  const pageParam = Number(readSearchParamString(sp['page']) ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.max(1, Math.floor(pageParam)) : 1;

  const emailWhere = {
    workspaceId: ctx.workspaceId,
    deletedAt: null,
    ...(clientFilter ? { clientId: clientFilter } : {}),
    ...(mailboxFilter ? { integrationId: mailboxFilter } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    prisma.emailMessage.findMany({
      where: emailWhere,
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
        integration: { select: { externalAccountLabel: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.emailMessage.count({ where: emailWhere }),
  ]);
  const mails = rows.map(toMailDTO);
  const unreadCount = rows.filter((r) => !r.isRead).length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Most recently synced mailbox across Graph + IMAP drives the "last synced"
  // label — nulls last so a mailbox that hasn't synced yet doesn't hide a
  // fresher sibling's timestamp.
  const refreshedIntegration = await prisma.integration.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      kind: { in: ['graph', 'imap'] },
      ownerUserId: ctx.userId,
      status: { in: ['active', 'error'] },
    },
    select: { lastSyncedAt: true },
    orderBy: { lastSyncedAt: { sort: 'desc', nulls: 'last' } },
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
          mailboxFilter={
            <MailboxFilter options={mailboxOptions} initialMailboxId={mailboxFilter} />
          }
        />
        {mails.length === 0 ? (
          <div className="p-10 text-center text-sm text-[color:var(--color-text-muted)]">
            Aucun mail à afficher pour l&apos;instant.
          </div>
        ) : (
          <MailList key={page} mails={mails} showMailboxBadge={!mailboxFilter} />
        )}
        {totalCount > PAGE_SIZE ? (
          <MailPagination page={page} totalPages={totalPages} totalCount={totalCount} />
        ) : null}
      </div>
    </div>
  );
}
