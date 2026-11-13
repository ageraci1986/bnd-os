/**
 * Bloc « Activité » de l'Overview. L'app n'écrit pas (encore) de journal
 * d'activité : le fil est reconstitué à partir des horodatages existants
 * (cartes créées, cartes terminées, commentaires, projets créés), dans le
 * périmètre visible par l'utilisateur. Le contenu des commentaires n'est
 * jamais exposé ici, seulement le titre de la carte.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { type UserScope } from '@nexushub/domain';
import { scopedProjectWhere } from '@/lib/auth/scope';

export type ActivityKind = 'card_created' | 'card_completed' | 'comment_added' | 'project_created';

export interface ActivityItem {
  readonly key: string;
  readonly kind: ActivityKind;
  readonly at: Date;
  /** Null quand l'auteur n'est pas enregistré (carte terminée, projet créé). */
  readonly actor: { readonly name: string; readonly initials: string } | null;
  readonly title: string;
  readonly projectId: string;
  readonly cardId: string | null;
}

export interface RecentActivityOptions {
  readonly workspaceId: string;
  readonly clientId?: string;
  readonly scope?: UserScope;
  readonly take?: number;
}

interface Person {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string;
}

/** Prénom affiché + initiales ; repli sur la partie locale de l'e-mail. */
export function toActor(p: Person | null): ActivityItem['actor'] {
  if (!p) return null;
  const local = p.email.split('@')[0] ?? '';
  const name = p.firstName?.trim() || local;
  const initials = (
    p.firstName && p.lastName ? `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}` : name.slice(0, 2)
  ).toUpperCase();
  return { name, initials };
}

/** Fusionne plusieurs flux déjà triés : plus récent d'abord, `take` éléments. */
export function mergeActivity(
  streams: readonly (readonly ActivityItem[])[],
  take: number,
): ActivityItem[] {
  return streams
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key))
    .slice(0, take);
}

/** « 14 min », « 3 h », « hier », puis « 9 nov. ». */
export function relativeShort(at: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  if (hours < 48) return 'hier';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Paris',
  }).format(at);
}

const person = { select: { firstName: true, lastName: true, email: true } } as const;

export async function getRecentActivity({
  workspaceId,
  clientId,
  scope,
  take = 6,
}: RecentActivityOptions): Promise<readonly ActivityItem[]> {
  const projectWhere = {
    workspaceId,
    deletedAt: null,
    archivedAt: null,
    ...(scope ? scopedProjectWhere(scope) : {}),
    ...(clientId ? { clientId } : {}),
  };
  const cardWhere = { workspaceId, deletedAt: null, project: projectWhere };

  const [created, completed, comments, projects] = await Promise.all([
    prisma.card.findMany({
      where: cardWhere,
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, title: true, projectId: true, createdAt: true, createdBy: person },
    }),
    prisma.card.findMany({
      where: { ...cardWhere, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      take,
      select: { id: true, title: true, projectId: true, completedAt: true },
    }),
    prisma.comment.findMany({
      where: { deletedAt: null, card: cardWhere },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        createdAt: true,
        author: person,
        card: { select: { id: true, title: true, projectId: true } },
      },
    }),
    prisma.project.findMany({
      where: projectWhere,
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, name: true, createdAt: true },
    }),
  ]);

  return mergeActivity(
    [
      created.map((c) => ({
        key: `created:${c.id}`,
        kind: 'card_created' as const,
        at: c.createdAt,
        actor: toActor(c.createdBy),
        title: c.title,
        projectId: c.projectId,
        cardId: c.id,
      })),
      completed.flatMap((c) =>
        c.completedAt
          ? [
              {
                key: `completed:${c.id}`,
                kind: 'card_completed' as const,
                at: c.completedAt,
                actor: null,
                title: c.title,
                projectId: c.projectId,
                cardId: c.id,
              },
            ]
          : [],
      ),
      comments.map((c) => ({
        key: `comment:${c.id}`,
        kind: 'comment_added' as const,
        at: c.createdAt,
        actor: toActor(c.author),
        title: c.card.title,
        projectId: c.card.projectId,
        cardId: c.card.id,
      })),
      projects.map((p) => ({
        key: `project:${p.id}`,
        kind: 'project_created' as const,
        at: p.createdAt,
        actor: null,
        title: p.name,
        projectId: p.id,
        cardId: null,
      })),
    ],
    take,
  );
}
