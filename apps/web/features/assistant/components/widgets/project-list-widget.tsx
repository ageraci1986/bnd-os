import { z } from 'zod';
import Link from 'next/link';
import { parseWidgetData } from './parse-widget-data';

/** Shape produite par le tool `list_projects` (read-tools.ts). Extras tolérés. */
const ProjectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  client: z.string(),
  cards: z.number().int().nonnegative(),
});

/**
 * Deux formes acceptées (Task 6, total/truncated) :
 * - tableau nu (legacy) : messages déjà commités dans le fil AVANT l'ajout de
 *   l'enveloppe — rendu identique, jamais de pied de page.
 * - enveloppe `{ projects, total?, truncated? }` (list_projects/find_projects
 *   actuels) : `total` (fourni par list_projects, absent pour find_projects
 *   qui ne compte pas ses candidats) permet d'afficher un pied « N affichés
 *   sur total » quand le serveur en détient plus que ce qui est montré.
 */
const ProjectListEnvelopeSchema = z.union([
  z.array(ProjectRowSchema),
  z.object({
    projects: z.array(ProjectRowSchema),
    total: z.number().optional(),
    truncated: z.boolean().optional(),
  }),
]);

export interface ProjectListWidgetProps {
  readonly data: unknown;
  /**
   * Nom du tool d'origine pour les logs `parseWidgetData` — `find_projects` a
   * une sortie identique à `list_projects` et partage ce widget.
   */
  readonly tool?: 'list_projects' | 'find_projects';
}

/** Cartes compactes pour `list_projects`/`find_projects` — nom + client + nb de cartes. */
export function ProjectListWidget({ data, tool = 'list_projects' }: ProjectListWidgetProps) {
  const parsed = parseWidgetData(tool, ProjectListEnvelopeSchema, data);
  if (parsed === null) return null;
  const projects = Array.isArray(parsed) ? parsed : parsed.projects;
  const total = Array.isArray(parsed) ? undefined : parsed.total;

  return (
    <div className="w-full">
      <ul className="grid w-full list-none grid-cols-1 gap-2 sm:grid-cols-2">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}`}
              className="block rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-3 py-2 no-underline hover:bg-[color:var(--color-bg-hover)]"
            >
              <p className="truncate text-xs font-bold text-[color:var(--color-text-main)]">
                {project.name}
              </p>
              <p className="truncate text-xs text-[color:var(--color-text-muted)]">
                {project.client} · {project.cards} carte{project.cards > 1 ? 's' : ''}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {total !== undefined && total > projects.length && (
        <p className="mt-1.5 px-1 text-[10px] text-[color:var(--color-text-ghost)]">
          {`${projects.length} affichés sur ${total}`}
        </p>
      )}
    </div>
  );
}
