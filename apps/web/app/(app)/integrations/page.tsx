import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { IntegrationsGrid } from '@/features/integrations/components/integrations-grid';
import { MailboxList } from '@/features/integrations/components/mailbox-list';
import type { MailboxCardData } from '@/features/integrations/components/mailbox-card';

export const metadata: Metadata = { title: 'Intégrations' };

interface PageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IntegrationsPage({ searchParams }: PageProps) {
  const ctx = await requireUser();
  // `revoked` rows are intentionally excluded — once a mailbox is
  // disconnected, its row disappears from the list so re-connecting starts
  // fresh instead of resurrecting stale state.
  const integrations = await prisma.integration.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: { in: ['graph', 'imap'] },
      status: { in: ['active', 'error'] },
    },
    select: {
      id: true,
      kind: true,
      status: true,
      externalAccountLabel: true,
      lastSyncedAt: true,
      lastError: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const mailboxes: MailboxCardData[] = integrations.map((integration) => ({
    integrationId: integration.id,
    kind: integration.kind as MailboxCardData['kind'],
    label:
      integration.externalAccountLabel ??
      (integration.kind === 'graph' ? 'Microsoft Outlook' : 'IMAP'),
    status: integration.status as MailboxCardData['status'],
    lastSyncedAt: integration.lastSyncedAt ? integration.lastSyncedAt.toISOString() : null,
    lastError: integration.lastError,
  }));

  const sp = (await searchParams) ?? {};
  const flash =
    sp['connected'] === 'graph'
      ? { kind: 'ok' as const, msg: 'Boîte Outlook connectée.' }
      : sp['connected'] === 'imap'
        ? { kind: 'ok' as const, msg: 'Boîte IMAP connectée.' }
        : typeof sp['error'] === 'string'
          ? { kind: 'err' as const, msg: `Erreur OAuth: ${sp['error']}` }
          : null;

  return (
    <div className="mx-auto max-w-[900px]">
      <header className="mb-6">
        <h1 className="text-[28px] font-extrabold tracking-tight">Intégrations</h1>
        <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          Connecte tes outils externes à NexusHub.
        </p>
      </header>
      {flash ? (
        <div
          className={
            flash.kind === 'ok'
              ? 'mb-4 rounded-lg border border-[color:var(--color-success)] bg-[color:var(--color-success-bg)] px-4 py-2 text-sm text-[color:var(--color-success)]'
              : 'mb-4 rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-4 py-2 text-sm text-[color:var(--color-danger)]'
          }
        >
          {flash.msg}
        </div>
      ) : null}
      <MailboxList mailboxes={mailboxes} />
      <IntegrationsGrid />
    </div>
  );
}
