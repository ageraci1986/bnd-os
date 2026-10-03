import 'server-only';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';

/**
 * Cœur partagé des pièces jointes de cartes (lot C, spec §3-§4) : accès à
 * la carte (workspace + scope projet), DTO de liste, règle de suppression.
 * Toutes les requêtes Prisma sont scopées `workspaceId: ctx.workspaceId`
 * (CLAUDE.md §4.4.2) — jamais d'identifiant de workspace venant du client.
 */

export interface CardAttachmentDTO {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly scanStatus: 'pending' | 'clean' | 'dirty' | 'scan_failed';
  readonly uploaderName: string | null;
  readonly createdAt: string; // ISO
  readonly canDelete: boolean;
}

/** Carte accessible (workspace + scope projet), non supprimée. null sinon. */
export async function loadAccessibleCard(
  ctx: AuthContext,
  cardId: string,
): Promise<{ id: string; projectId: string } | null> {
  const [card, scope] = await Promise.all([
    prisma.card.findFirst({
      where: { id: cardId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, projectId: true, project: { select: { clientId: true } } },
    }),
    loadUserScope(ctx),
  ]);
  if (!card) return null;
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) return null;
  }
  return { id: card.id, projectId: card.projectId };
}

/** Auteur ou Admin (jamais Viewer). */
export function canDeleteAttachment(ctx: AuthContext, uploadedById: string | null): boolean {
  if (ctx.role === Roles.Viewer) return false;
  return ctx.role === Roles.Admin || (uploadedById !== null && uploadedById === ctx.userId);
}

function displayName(
  user: { firstName: string | null; lastName: string | null; email: string } | null,
): string | null {
  if (!user) return null;
  const full = [user.firstName, user.lastName]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ')
    .trim();
  return full.length > 0 ? full : user.email;
}

/** PJ de la carte visibles (non dirty/scan_failed), triées par createdAt asc. */
export async function listCardAttachmentDTOs(
  ctx: AuthContext,
  cardId: string,
): Promise<CardAttachmentDTO[]> {
  const rows = await prisma.cardAttachment.findMany({
    where: { workspaceId: ctx.workspaceId, cardId, scanStatus: { in: ['pending', 'clean'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      scanStatus: true,
      createdAt: true,
      uploadedById: true,
      uploadedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    scanStatus: row.scanStatus,
    uploaderName: displayName(row.uploadedBy),
    createdAt: row.createdAt.toISOString(),
    canDelete: canDeleteAttachment(ctx, row.uploadedById),
  }));
}

/** Catégorie de rejet montrée à l'auteur (jamais le détail technique). */
export type AttachmentRejectReason = 'virus' | 'type' | 'size' | 'scan_failed';

export interface RejectedAttachmentDTO {
  readonly id: string;
  readonly rejectReason: AttachmentRejectReason;
}

/** Fenêtre pendant laquelle l'auteur est notifié d'un rejet (toast). */
const RECENT_REJECTION_MS = 10 * 60 * 1000;

/** `scanReport.reason` (écrit par `scan-card-attachment`) → catégorie UI. */
export function rejectReasonCategory(scanReport: unknown): AttachmentRejectReason {
  const reason =
    scanReport !== null && typeof scanReport === 'object' && !Array.isArray(scanReport)
      ? (scanReport as { reason?: unknown }).reason
      : undefined;
  switch (reason) {
    case 'virus':
      return 'virus';
    case 'type_spoof':
    case 'type_mismatch':
      return 'type';
    case 'size_mismatch':
      return 'size';
    default:
      return 'scan_failed';
  }
}

/**
 * PJ de l'APPELANT rejetées (`dirty`/`scan_failed`) dans les 10 dernières
 * minutes : permet un toast explicite quand une PJ « Analyse en cours… »
 * disparaît. Ni nom de fichier ni rapport brut — id + catégorie seulement.
 */
export async function listRecentlyRejectedAttachments(
  ctx: AuthContext,
  cardId: string,
  now: Date = new Date(),
): Promise<RejectedAttachmentDTO[]> {
  const rows = await prisma.cardAttachment.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      cardId,
      uploadedById: ctx.userId,
      scanStatus: { in: ['dirty', 'scan_failed'] },
      updatedAt: { gte: new Date(now.getTime() - RECENT_REJECTION_MS) },
    },
    select: { id: true, scanReport: true },
  });
  return rows.map((row) => ({ id: row.id, rejectReason: rejectReasonCategory(row.scanReport) }));
}
