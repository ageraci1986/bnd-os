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
import { startOfTodayUtc } from '@/features/projects/lib/card-filter';
import { fetchMailBody } from '@/features/communications/actions/fetch-mail-body';

const uuid = z.string().uuid();
const UUID_JSON = { type: 'string', format: 'uuid' } as const;

/** Nb max de cartes renvoyées par colonne dans get_project_board. */
const BOARD_CARDS_PER_COLUMN = 100;
/** Longueur max du corps de mail renvoyé par read_mail. */
const MAIL_BODY_MAX_CHARS = 5000;
/** Longueur max de la description de carte renvoyée par get_card. */
const CARD_DESCRIPTION_MAX_CHARS = 5000;
/** Nb max de membres renvoyés par get_team_members. */
const TEAM_MEMBERS_MAX = 50;
/** Nb max d'items de checklist renvoyés par get_card. */
const CARD_CHECKLIST_MAX = 50;

/**
 * Exécute une requête DB en reformulant toute erreur en message montrable.
 * Contrat `defineTool` : seul un message user-safe peut s'échapper d'un handler —
 * les erreurs Prisma brutes (connexion, contraintes…) ne doivent jamais fuiter.
 * Retourne (plutôt que de relancer) le message sûr : chaque handler ci-dessous
 * renvoie toujours une `string`, donc l'appelant récupère directement le texte
 * affichable sans avoir à intercepter une exception.
 *
 * `tool` sert uniquement d'étiquette de log serveur — jamais le contenu de
 * l'erreur ni la requête (PII / secrets, CLAUDE.md §4.7).
 */
async function safeDb(tool: string, work: () => Promise<string>): Promise<string> {
  try {
    return await work();
  } catch {
    console.error('[assistant] tool db error', { tool });
    return 'Erreur interne en consultant les données — réessayez dans un instant.';
  }
}

export async function buildReadTools(ctx: AuthContext): Promise<ToolSpec[]> {
  const scope = await loadUserScope(ctx);
  const workspaceId = ctx.workspaceId;

  return [
    defineTool({
      name: 'get_current_datetime',
      description:
        "Date et heure actuelles : `iso` (UTC) et `parisLocal` (heure de Paris). Utiliser `parisLocal` pour raisonner sur « aujourd'hui » / « demain », `iso` pour les calculs.",
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () => {
        const now = new Date();
        const parisLocal = new Intl.DateTimeFormat('fr-FR', {
          timeZone: 'Europe/Paris',
          dateStyle: 'full',
          timeStyle: 'short',
        }).format(now);
        return JSON.stringify({ iso: now.toISOString(), parisLocal });
      },
    }),

    defineTool({
      name: 'get_today_overview',
      description:
        "Résumé du jour : nombre de cartes bloquées, cartes dues aujourd'hui, mails non lus, notifications non lues. Le point de départ de tout briefing.",
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () =>
        safeDb('get_today_overview', async () => {
          // Convention repo (card-filter.ts) : les échéances sont stockées à
          // minuit UTC — « dû aujourd'hui » = [minuit UTC, minuit UTC + 1 j).
          const start = startOfTodayUtc();
          const endExclusive = new Date(start);
          endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
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
        safeDb('list_projects', async () => {
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
        safeDb('get_project_board', async () => {
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
                    take: BOARD_CARDS_PER_COLUMN,
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
              ...(c.cards.length === BOARD_CARDS_PER_COLUMN ? { truncated: true } : {}),
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
        safeDb('list_clients', async () => {
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
        safeDb('search_mails', async () => {
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
      description:
        'Lit un mail complet (en-têtes + corps texte) à partir de son id. Limité aux mails de votre propre boîte connectée.',
      inputSchema: z.object({ emailId: uuid }),
      jsonSchema: { type: 'object', properties: { emailId: UUID_JSON }, required: ['emailId'] },
      handler: async (input) =>
        safeDb('read_mail', async () => {
          // Convention repo (fetch-mail-body.ts) : les métadonnées mail sont
          // visibles au workspace, les CORPS sont réservés au propriétaire de
          // l'intégration — d'où le gate ownerUserId ci-dessous.
          const mail = await prisma.emailMessage.findFirst({
            where: {
              id: input.emailId,
              workspaceId,
              deletedAt: null,
              integration: { workspaceId, ownerUserId: ctx.userId },
            },
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
          if (mail === null) {
            return "Erreur : mail introuvable, ou situé dans la boîte d'un autre membre (le corps des mails n'est lisible que par le propriétaire de la boîte).";
          }
          let bodyText = mail.bodyText;
          let bodyHtmlSanitized = mail.bodyHtmlSanitized;
          // Critère volontairement plus simple que `cachedIsUsable` de
          // fetch-mail-body.ts : absence totale de corps uniquement (un cache
          // mojibake/MIME non parsé n'est pas re-réparé ici — l'UI le fait).
          const hasUsableBody =
            (bodyText !== null && bodyText.length > 0) || bodyHtmlSanitized !== null;
          if (!hasUsableBody) {
            // Chargement paresseux : le corps n'a pas été récupéré au moment
            // du sync (voir fetch-mail-body.ts). L'ownership y est revalidé
            // en interne, et le résultat est mis en cache en DB.
            // Note : fetchMailBody appelle requireUser() en interne et lève
            // NEXT_REDIRECT si la session a expiré ; cette exception remonte
            // à travers `safeDb`, qui la transforme déjà en message générique
            // — acceptable ici, pas besoin d'un try/catch dédié.
            const fetched = await fetchMailBody({ emailId: input.emailId });
            if (!fetched.ok) return `Erreur : ${fetched.message}`;
            bodyText = fetched.bodyText;
            bodyHtmlSanitized = fetched.bodyHtmlSanitized;
          }
          const rawBody =
            bodyText ??
            (bodyHtmlSanitized !== null
              ? bodyHtmlSanitized
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()
              : '(ce mail ne contient aucun corps de texte)');
          const body =
            rawBody.length > MAIL_BODY_MAX_CHARS
              ? `${rawBody.slice(0, MAIL_BODY_MAX_CHARS)} […corps tronqué]`
              : rawBody;
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

    defineTool({
      name: 'get_team_members',
      description: 'Membres du workspace (id, email, rôle) — nécessaire pour assigner une carte.',
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () =>
        safeDb('get_team_members', async () => {
          // Les emails des membres sont visibles à tout le workspace : même
          // précédent que les pickers assignés/RACI des pages projets, qui les
          // exposent déjà à tout Membre via requireUser
          // (cf. app/(app)/projects/[id]/page.tsx).
          const members = await prisma.membership.findMany({
            where: { workspaceId },
            select: {
              role: true,
              user: { select: { id: true, email: true, firstName: true, lastName: true } },
            },
            orderBy: { user: { email: 'asc' } },
            take: TEAM_MEMBERS_MAX,
          });
          return JSON.stringify({
            members: members.map((m) => ({
              userId: m.user.id,
              email: m.user.email,
              name: [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || null,
              role: m.role,
            })),
            ...(members.length === TEAM_MEMBERS_MAX ? { truncated: true } : {}),
          });
        }),
    }),

    defineTool({
      name: 'get_card',
      description:
        "Détail d'une carte : titre, description, colonne, échéance, assignés, checklist.",
      inputSchema: z.object({ cardId: uuid }),
      jsonSchema: { type: 'object', properties: { cardId: UUID_JSON }, required: ['cardId'] },
      handler: async (input) =>
        safeDb('get_card', async () => {
          const card = await prisma.card.findFirst({
            where: { id: input.cardId, workspaceId, deletedAt: null, ...scopedCardWhere(scope) },
            select: {
              id: true,
              title: true,
              description: true,
              dueDate: true,
              shortRef: true,
              column: { select: { id: true, name: true, isBlockedSystem: true } },
              project: { select: { id: true, name: true } },
              assignees: { select: { userId: true, raci: true } },
              checklistItems: {
                select: { title: true, isChecked: true },
                orderBy: { position: 'asc' },
                take: CARD_CHECKLIST_MAX,
              },
            },
          });
          if (card === null) return 'Erreur : carte introuvable ou hors de votre périmètre.';
          const description =
            card.description !== null && card.description.length > CARD_DESCRIPTION_MAX_CHARS
              ? `${card.description.slice(0, CARD_DESCRIPTION_MAX_CHARS)} […tronqué]`
              : card.description;
          return JSON.stringify({
            ...card,
            description,
            ...(card.checklistItems.length === CARD_CHECKLIST_MAX
              ? { checklistTruncated: true }
              : {}),
          });
        }),
    }),
  ];
}
