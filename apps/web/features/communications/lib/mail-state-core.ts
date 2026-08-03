import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import type { Prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { VIEWER_READ_ONLY_MESSAGE } from '@/features/projects/lib/scope-error';

/**
 * Bulk mail state core (Plan 5b Task 7).
 *
 * Applique un changement d'état à un lot de mails — BOÎTES DE L'UTILISATEUR
 * UNIQUEMENT (ownership via integration.ownerUserId, décision produit V2) :
 * un mail d'une boîte d'un autre membre est silencieusement ignoré et compté
 * dans `skipped`. Contraste assumé avec la lecture (métadonnées workspace) et
 * avec l'action UI markEmailRead (mono-mail, workspace-scopée) — voir le
 * commentaire croisé dans mark-email-read.ts.
 * Archive/delete sont LOCAUX à NexusHub (aucune sync retour IMAP/Graph).
 *
 * Le `where` ne filtre volontairement PAS sur `archivedAt` : marquer un mail
 * archivé lu/non-lu doit fonctionner (on ne veut pas désarchiver au passage,
 * donc on n'y touche simplement pas ici).
 */

export type MailStateOp = 'read' | 'unread' | 'archive' | 'delete';
export const MAIL_BULK_MAX = 100;

const OP_TO_AUDIT = {
  read: 'mail_marked_read',
  unread: 'mail_marked_unread',
  archive: 'mail_archived',
  delete: 'mail_deleted',
} as const;

export type SetMailStateCoreResult =
  | { readonly ok: true; readonly affected: number; readonly skipped: number }
  | { readonly ok: false; readonly message: string };

export async function setMailStateCore(
  ctx: AuthContext,
  input: { readonly mailIds: readonly string[]; readonly op: MailStateOp },
): Promise<SetMailStateCoreResult> {
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }

  // Dédoublonnage AVANT tout comptage (plafond + `skipped` exact).
  const mailIds = [...new Set(input.mailIds)];

  if (mailIds.length === 0) {
    return { ok: false, message: 'Aucun mail fourni.' };
  }
  if (mailIds.length > MAIL_BULK_MAX) {
    return { ok: false, message: `Maximum ${MAIL_BULK_MAX} mails par opération.` };
  }

  const data =
    input.op === 'read'
      ? { isRead: true }
      : input.op === 'unread'
        ? { isRead: false }
        : input.op === 'archive'
          ? { archivedAt: new Date() }
          : { deletedAt: new Date() };

  const result = await prisma.emailMessage.updateMany({
    where: {
      id: { in: mailIds },
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      integration: { ownerUserId: ctx.userId },
    },
    data,
  });

  // Audit compté : une entrée par OPÉRATION, jamais par mail — aucun id/sujet (PII).
  await recordAudit({
    action: OP_TO_AUDIT[input.op],
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'mail_bulk',
    subjectId: null,
    data: { count: result.count },
  });

  return { ok: true, affected: result.count, skipped: mailIds.length - result.count };
}

// --- Bulk par filtre (spec visibilité totale §2) --------------------------

/**
 * Filtre serveur des mutations de masse : au moins UN critère requis — un
 * filtre vide est rejeté (jamais de « tout » implicite). Bornes de longueur
 * contre les scans pathologiques ; dates ISO converties en bornes receivedAt.
 */
export const MailFilterSchema = z
  .object({
    fromContains: z.string().min(3).max(120).optional(),
    subjectContains: z.string().min(3).max(120).optional(),
    folder: z.string().min(1).max(16).optional(),
    isRead: z.boolean().optional(),
    receivedBefore: z.string().datetime({ offset: true }).optional(),
    receivedAfter: z.string().datetime({ offset: true }).optional(),
  })
  .refine((f) => Object.values(f).some((v) => v !== undefined), {
    message: 'Au moins un critère de filtre est requis.',
  });
export type MailFilter = z.infer<typeof MailFilterSchema>;

/**
 * `where` UNIQUE partagé entre le describeForConfirm (count) et l'exécution
 * (updateMany) — l'invariant central : le compte annoncé est calculé avec
 * exactement le même filtre que la mutation. `op` ajuste les exclusions
 * op-spécifiques (archive ne recompte pas les déjà-archivés).
 */
export function buildMailFilterWhere(
  ctx: Pick<AuthContext, 'userId' | 'workspaceId'>,
  filter: MailFilter,
  op?: MailStateOp,
): Prisma.EmailMessageWhereInput {
  return {
    workspaceId: ctx.workspaceId,
    deletedAt: null,
    integration: { ownerUserId: ctx.userId },
    ...(op === 'archive' ? { archivedAt: null } : {}),
    ...(filter.isRead !== undefined ? { isRead: filter.isRead } : {}),
    ...(filter.folder !== undefined ? { folder: filter.folder } : {}),
    ...(filter.subjectContains !== undefined
      ? { subject: { contains: filter.subjectContains, mode: 'insensitive' } }
      : {}),
    ...(filter.fromContains !== undefined
      ? {
          OR: [
            { fromEmail: { contains: filter.fromContains, mode: 'insensitive' } },
            { fromName: { contains: filter.fromContains, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(filter.receivedBefore !== undefined || filter.receivedAfter !== undefined
      ? {
          receivedAt: {
            ...(filter.receivedAfter !== undefined ? { gte: new Date(filter.receivedAfter) } : {}),
            ...(filter.receivedBefore !== undefined ? { lt: new Date(filter.receivedBefore) } : {}),
          },
        }
      : {}),
  };
}

export async function countMailsByFilter(
  ctx: Pick<AuthContext, 'userId' | 'workspaceId'>,
  filter: MailFilter,
  op: MailStateOp,
): Promise<number> {
  return prisma.emailMessage.count({ where: buildMailFilterWhere(ctx, filter, op) });
}

/** Mutation de masse par filtre — SANS plafond (spec §2), un seul updateMany. */
export async function setMailStateByFilterCore(
  ctx: AuthContext,
  input: { readonly filter: MailFilter; readonly op: MailStateOp },
): Promise<SetMailStateCoreResult> {
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }
  const data =
    input.op === 'read'
      ? { isRead: true }
      : input.op === 'unread'
        ? { isRead: false }
        : input.op === 'archive'
          ? { archivedAt: new Date() }
          : { deletedAt: new Date() };
  const result = await prisma.emailMessage.updateMany({
    where: buildMailFilterWhere(ctx, input.filter, input.op),
    data,
  });
  await recordAudit({
    action: OP_TO_AUDIT[input.op],
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'mail_bulk_filter',
    // Filtre normalisé (clés/valeurs bornées par Zod) — jamais de contenu de mail.
    data: { filter: input.filter, affected: result.count },
  });
  return { ok: true, affected: result.count, skipped: 0 };
}
