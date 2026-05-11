import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { validateCardTemplateItems } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { EditorShell } from '@/features/templates/cards/editor-shell';
import type { TemplateDTO } from '@/features/templates/cards/use-editor-state';

export const metadata: Metadata = { title: 'Templates Cartes' };

export default async function CardTemplatesPage() {
  const ctx = await requireUser();

  const rows = await prisma.cardTemplate.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      items: true,
      isDefault: true,
    },
  });

  const templates: TemplateDTO[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    items: validateCardTemplateItems(t.items) ?? [],
    isDefault: t.isDefault,
  }));

  return (
    <div className="mx-auto max-w-[1280px]">
      <header className="mb-6">
        <h1 className="text-[34px] font-extrabold tracking-tight">Templates de cartes</h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Compose le contenu d'une carte : champs, sections, description. L'aperçu à droite reflète
          exactement le rendu dans Projets.
        </p>
      </header>

      <EditorShell initialTemplates={templates} />
    </div>
  );
}
