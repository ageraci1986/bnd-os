import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { KanbanEditorShell } from '@/features/templates/kanban/editor-shell';
import type { KanbanTemplateDTO } from '@/features/templates/kanban/use-editor-state';

export const metadata: Metadata = { title: 'Templates Kanban' };

export default async function KanbanTemplatesPage() {
  const ctx = await requireUser();

  const [rows, cardTemplates] = await Promise.all([
    prisma.kanbanTemplate.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ isBuiltin: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        isBuiltin: true,
        defaultCardTemplateId: true,
        columns: {
          orderBy: { position: 'asc' },
          select: { id: true, name: true, stepChecklist: true },
        },
      },
    }),
    prisma.cardTemplate.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isDefault: true },
    }),
  ]);

  const templates: KanbanTemplateDTO[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    isBuiltin: t.isBuiltin,
    defaultCardTemplateId: t.defaultCardTemplateId,
    columns: t.columns.map((c) => ({
      id: c.id,
      name: c.name,
      stepChecklist: c.stepChecklist,
    })),
  }));

  return (
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-6">
        <h1 className="text-[34px] font-extrabold tracking-tight">
          Templates <span className="gradient-text">Kanban</span>
        </h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Définis des structures de colonnes prêtes à consommer lors de la création d&apos;un
          projet. Chaque colonne peut avoir une step-checklist : ses items seront automatiquement
          ajoutés à chaque carte qui passe dans la colonne.
        </p>
      </header>

      <KanbanEditorShell initialTemplates={templates} cardTemplateOptions={cardTemplates} />
    </div>
  );
}
