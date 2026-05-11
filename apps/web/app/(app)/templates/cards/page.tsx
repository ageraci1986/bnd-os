import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { validateCardFields } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { CardTemplateEditor, type CardTemplateOption } from '@/features/templates/cards/editor';

export const metadata: Metadata = { title: 'Templates Cartes' };

export default async function CardTemplatesPage() {
  const ctx = await requireUser();

  const rows = await prisma.cardTemplate.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      body: true,
      fields: true,
      defaultChecklist: true,
      isDefault: true,
    },
  });

  const templates: CardTemplateOption[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    body: t.body,
    fields: validateCardFields(t.fields) ?? [],
    defaultChecklist: t.defaultChecklist,
    isDefault: t.isDefault,
  }));

  return (
    <div className="mx-auto max-w-[1200px]">
      <header className="mb-6">
        <h1 className="text-[34px] font-extrabold tracking-tight">Templates de cartes</h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Pré-remplissez le brief + la checklist de vos cartes Kanban. Le template marqué « Défaut »
          est appliqué automatiquement à chaque nouvelle carte.
        </p>
      </header>

      <CardTemplateEditor templates={templates} />
    </div>
  );
}
