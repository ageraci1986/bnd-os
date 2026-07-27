import { z } from 'zod';
import Link from 'next/link';

/** Shape produite par le tool `list_projects` (read-tools.ts). Extras tolérés. */
const ProjectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  client: z.string(),
  cards: z.number().int().nonnegative(),
});

const ProjectListSchema = z.array(ProjectRowSchema);

export interface ProjectListWidgetProps {
  readonly data: unknown;
}

/** Cartes compactes pour `list_projects` — nom + client + nb de cartes. */
export function ProjectListWidget({ data }: ProjectListWidgetProps) {
  const parsed = ProjectListSchema.safeParse(data);
  if (!parsed.success) return null;
  const projects = parsed.data;

  return (
    <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
      {projects.map((project) => (
        <Link
          key={project.id}
          href={`/projects/${project.id}`}
          className="rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-3 py-2 no-underline hover:bg-[color:var(--color-bg-hover)]"
        >
          <p className="truncate text-xs font-bold text-[color:var(--color-text-main)]">
            {project.name}
          </p>
          <p className="truncate text-xs text-[color:var(--color-text-muted)]">
            {project.client} · {project.cards} carte{project.cards > 1 ? 's' : ''}
          </p>
        </Link>
      ))}
    </div>
  );
}
