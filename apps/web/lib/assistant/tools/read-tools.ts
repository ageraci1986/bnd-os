import 'server-only';

import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import {
  loadUserScope,
  scopedCardWhere,
  scopedClientWhere,
  scopedProjectWhere,
} from '@/lib/auth/scope';

const uuid = z.string().uuid();
const UUID_JSON = { type: 'string', format: 'uuid' } as const;

function dayRange(now: Date): { start: Date; endExclusive: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { start, endExclusive };
}

/**
 * Exécute une requête DB en reformulant toute erreur en message montrable.
 * Contrat `defineTool` : seul un message user-safe peut s'échapper d'un handler —
 * les erreurs Prisma brutes (connexion, contraintes…) ne doivent jamais fuiter.
 * Retourne (plutôt que de relancer) le message sûr : chaque handler ci-dessous
 * renvoie toujours une `string`, donc l'appelant récupère directement le texte
 * affichable sans avoir à intercepter une exception.
 */
async function safeDb(work: () => Promise<string>): Promise<string> {
  try {
    return await work();
  } catch {
    return 'Erreur interne en consultant les données — réessayez dans un instant.';
  }
}

export async function buildReadTools(ctx: AuthContext): Promise<ToolSpec[]> {
  const scope = await loadUserScope(ctx);
  const workspaceId = ctx.workspaceId;

  return [
    defineTool({
      name: 'get_current_datetime',
      description: 'Date et heure actuelles (ISO). À utiliser avant tout calcul de date.',
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () => new Date().toISOString(),
    }),

    defineTool({
      name: 'get_today_overview',
      description:
        "Résumé du jour : nombre de cartes bloquées, cartes dues aujourd'hui, mails non lus, notifications non lues. Le point de départ de tout briefing.",
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () =>
        safeDb(async () => {
          const { start, endExclusive } = dayRange(new Date());
          const [blockedCards, dueTodayCards, unreadMails, unreadNotifications] = await Promise.all(
            [
              prisma.card.count({
                where: {
                  workspaceId,
                  deletedAt: null,
                  column: { isBlockedSystem: true },
                  ...scopedCardWhere(scope),
                },
              }),
              prisma.card.count({
                where: {
                  workspaceId,
                  deletedAt: null,
                  archivedAt: null,
                  dueDate: { gte: start, lt: endExclusive },
                  ...scopedCardWhere(scope),
                },
              }),
              prisma.emailMessage.count({ where: { workspaceId, deletedAt: null, isRead: false } }),
              prisma.notification.count({
                where: { workspaceId, userId: ctx.userId, readAt: null },
              }),
            ],
          );
          return JSON.stringify({ blockedCards, dueTodayCards, unreadMails, unreadNotifications });
        }),
    }),

    defineTool({
      name: 'list_projects',
      description: 'Liste des projets actifs du workspace (id, nom, client, nombre de cartes).',
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () =>
        safeDb(async () => {
          const projects = await prisma.project.findMany({
            where: { workspaceId, deletedAt: null, ...scopedProjectWhere(scope) },
            select: {
              id: true,
              name: true,
              client: { select: { name: true } },
              _count: { select: { cards: true } },
            },
            orderBy: { name: 'asc' },
            take: 50,
          });
          return JSON.stringify(
            projects.map((p) => ({
              id: p.id,
              name: p.name,
              client: p.client.name,
              cards: p._count.cards,
            })),
          );
        }),
    }),

    defineTool({
      name: 'get_project_board',
      description:
        "Le Kanban d'un projet : colonnes ordonnées avec leurs cartes (id, titre, échéance, colonne bloquée ou non).",
      inputSchema: z.object({ projectId: uuid }),
      jsonSchema: { type: 'object', properties: { projectId: UUID_JSON }, required: ['projectId'] },
      handler: async (input) =>
        safeDb(async () => {
          const project = await prisma.project.findFirst({
            where: {
              id: input.projectId,
              workspaceId,
              deletedAt: null,
              ...scopedProjectWhere(scope),
            },
            select: {
              id: true,
              name: true,
              columns: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  name: true,
                  isBlockedSystem: true,
                  cards: {
                    where: { deletedAt: null, archivedAt: null },
                    orderBy: { position: 'asc' },
                    select: { id: true, title: true, dueDate: true },
                  },
                },
              },
            },
          });
          if (project === null) return 'Erreur : projet introuvable ou hors de votre périmètre.';
          return JSON.stringify({
            id: project.id,
            name: project.name,
            columns: project.columns.map((c) => ({
              id: c.id,
              name: c.name,
              blocked: c.isBlockedSystem,
              cards: c.cards.map((card) => ({ id: card.id, title: card.title, due: card.dueDate })),
            })),
          });
        }),
    }),

    defineTool({
      name: 'list_clients',
      description: 'Liste des clients du workspace (id, nom, initiales, nb projets/contacts).',
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () =>
        safeDb(async () => {
          const clients = await prisma.client.findMany({
            where: { workspaceId, deletedAt: null, ...scopedClientWhere(scope) },
            select: {
              id: true,
              name: true,
              initials: true,
              _count: { select: { projects: true, contacts: true } },
            },
            orderBy: { name: 'asc' },
            take: 100,
          });
          return JSON.stringify(
            clients.map((c) => ({
              id: c.id,
              name: c.name,
              initials: c.initials,
              projects: c._count.projects,
              contacts: c._count.contacts,
            })),
          );
        }),
    }),

    defineTool({
      name: 'search_mails',
      description:
        "Recherche dans les mails du workspace par texte (sujet ou expéditeur). Renvoie les plus récents d'abord.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(100).optional(),
        unreadOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: "Texte cherché dans le sujet ou l'expéditeur" },
          unreadOnly: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 25 },
        },
      },
      handler: async (input) =>
        safeDb(async () => {
          const mails = await prisma.emailMessage.findMany({
            where: {
              workspaceId,
              deletedAt: null,
              ...(input.unreadOnly === true ? { isRead: false } : {}),
              ...(input.query !== undefined
                ? {
                    OR: [
                      { subject: { contains: input.query, mode: 'insensitive' } },
                      { fromEmail: { contains: input.query, mode: 'insensitive' } },
                      { fromName: { contains: input.query, mode: 'insensitive' } },
                    ],
                  }
                : {}),
            },
            select: {
              id: true,
              subject: true,
              fromEmail: true,
              fromName: true,
              receivedAt: true,
              isRead: true,
              folder: true,
            },
            orderBy: { receivedAt: 'desc' },
            take: input.limit ?? 10,
          });
          return JSON.stringify(mails);
        }),
    }),

    defineTool({
      name: 'read_mail',
      description: 'Lit un mail complet (en-têtes + corps texte) à partir de son id.',
      inputSchema: z.object({ emailId: uuid }),
      jsonSchema: { type: 'object', properties: { emailId: UUID_JSON }, required: ['emailId'] },
      handler: async (input) =>
        safeDb(async () => {
          const mail = await prisma.emailMessage.findFirst({
            where: { id: input.emailId, workspaceId, deletedAt: null },
            select: {
              id: true,
              subject: true,
              fromEmail: true,
              fromName: true,
              toRecipients: true,
              receivedAt: true,
              bodyText: true,
              bodyHtmlSanitized: true,
              isRead: true,
            },
          });
          if (mail === null) return 'Erreur : mail introuvable dans ce workspace.';
          const body =
            mail.bodyText ??
            (mail.bodyHtmlSanitized !== null
              ? mail.bodyHtmlSanitized
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()
              : "(corps non chargé — il sera récupéré à l'ouverture du mail dans Communications)");
          return JSON.stringify({
            id: mail.id,
            subject: mail.subject,
            from: `${mail.fromName ?? ''} <${mail.fromEmail}>`.trim(),
            to: mail.toRecipients,
            receivedAt: mail.receivedAt,
            isRead: mail.isRead,
            body,
          });
        }),
    }),
  ];
}
