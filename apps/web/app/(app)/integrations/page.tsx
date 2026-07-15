import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { IntegrationsGrid } from '@/features/integrations/components/integrations-grid';
import type { OutlookCardData } from '@/features/integrations/components/outlook-card';

export const metadata: Metadata = { title: 'Intégrations' };

interface PageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IntegrationsPage({ searchParams }: PageProps) {
  const ctx = await requireUser();
  // Prefer an active/error row over a revoked one — connecting a different
  // mailbox after a disconnect leaves the old row in `revoked` state and
  // creates a new one, so the arbitrary findFirst could show the wrong card.
  // We also fall back to the most-recently-touched row when only revoked
  // rows exist (so the "Précédemment connecté" state stays honest).
  const integration =
    (await prisma.integration.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        kind: 'graph',
        ownerUserId: ctx.userId,
        status: { in: ['active', 'error'] },
      },
      select: {
        status: true,
        externalAccountLabel: true,
        lastSyncedAt: true,
        lastError: true,
      },
      orderBy: { updatedAt: 'desc' },
    })) ??
    (await prisma.integration.findFirst({
      where: { workspaceId: ctx.workspaceId, kind: 'graph', ownerUserId: ctx.userId },
      select: {
        status: true,
        externalAccountLabel: true,
        lastSyncedAt: true,
        lastError: true,
      },
      orderBy: { updatedAt: 'desc' },
    }));
  const outlook: OutlookCardData = integration
    ? {
        status: integration.status as OutlookCardData['status'],
        externalAccountLabel: integration.externalAccountLabel,
        lastSyncedAt: integration.lastSyncedAt ? integration.lastSyncedAt.toISOString() : null,
        lastError: integration.lastError,
      }
    : { status: 'inactive', externalAccountLabel: null, lastSyncedAt: null, lastError: null };

  const sp = (await searchParams) ?? {};
  const flash =
    sp['connected'] === 'graph'
      ? { kind: 'ok' as const, msg: 'Boîte Outlook connectée.' }
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
      <IntegrationsGrid outlook={outlook} />
    </div>
  );
}
