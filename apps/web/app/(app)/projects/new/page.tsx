import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { ProjectWizard } from '@/features/projects/components/wizard';

export const metadata: Metadata = { title: 'Nouveau projet' };

export default async function NewProjectPage() {
  const ctx = await requireUser();
  const scope = await loadUserScope(ctx);
  // The createProject server action checks scope.clientIds (not project
  // ids) — a User with only project-level scope cannot create new
  // projects. The wizard's client picker mirrors that contract.
  const clientFilter = scope.kind === 'restricted' ? { id: { in: [...scope.clientIds] } } : {};
  const [csrf, clients, kanbanTemplates] = await Promise.all([
    getCsrfTokenForForm(),
    prisma.client.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        archivedAt: null,
        ...clientFilter,
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.kanbanTemplate.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ isBuiltin: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        columns: {
          orderBy: { position: 'asc' },
          select: { name: true, stepChecklist: true },
        },
      },
    }),
  ]);

  if (clients.length === 0) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-10 text-center shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-tight">Créez d&apos;abord un client</h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Un projet doit être rattaché à un client. Aucun client n&apos;est encore enregistré dans
          cet espace.
        </p>
        <a href="/clients" className="btn btn-primary mt-5 inline-block">
          Aller à Clients →
        </a>
      </div>
    );
  }

  return (
    <ProjectWizard
      csrfToken={csrf}
      clients={clients}
      workspaceTemplates={kanbanTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        columnNames: t.columns.map((c) => c.name),
        hasStepChecklists: t.columns.some((c) => c.stepChecklist.length > 0),
      }))}
    />
  );
}
