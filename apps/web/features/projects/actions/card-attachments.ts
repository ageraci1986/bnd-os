'use server';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import {
  CARD_ATTACHMENT_MAX_BYTES,
  CARD_ATTACHMENT_MAX_PER_CARD,
  Roles,
  isAllowedAttachment,
  sanitizeAttachmentFilename,
} from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import {
  cardAttachmentPath,
  createCardAttachmentUploadUrl,
  getCardAttachmentSignedUrl,
  removeCardAttachment,
} from '@/lib/card-attachment-storage';
import { inngestClient } from '@/lib/inngest/client';
import {
  canDeleteAttachment,
  listCardAttachmentDTOs,
  loadAccessibleCard,
  type CardAttachmentDTO,
} from '../lib/card-attachment-core';
import { VIEWER_READ_ONLY_MESSAGE } from '../lib/scope-error';

/**
 * Server Actions des pièces jointes de cartes (lot C, spec §3-§4).
 *
 * Sécurité (CLAUDE.md §4) : identité = session (`requireUser`) uniquement ;
 * chaque requête Prisma porte `workspaceId: ctx.workspaceId` ; entrées
 * validées Zod ; aucune erreur Storage brute ni nom de fichier renvoyé dans
 * les logs/audits (seuls type + taille). Le binaire n'est jamais servi tant
 * que le scan asynchrone (`scan-card-attachment`) ne l'a pas marqué `clean`.
 */

export interface AttachmentActionError {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

function fail(code: string, message: string): AttachmentActionError {
  return { ok: false, code, message };
}

const INVALID = (): AttachmentActionError => fail('INVALID_INPUT', 'Requête invalide.');
const NOT_FOUND = (): AttachmentActionError => fail('NOT_FOUND', 'Pièce jointe introuvable.');
const RATE_LIMITED = (): AttachmentActionError =>
  fail('RATE_LIMIT', 'Trop de requêtes. Réessaie plus tard.');

const VISIBLE_STATUSES = ['pending', 'clean'] as const;

const RequestSchema = z.object({
  cardId: z.string().uuid(),
  filename: z.string().min(1).max(1000),
  contentType: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\w.+-]+\/[\w.+-]+$/),
  sizeBytes: z.number().int().positive(),
});

const AttachmentIdSchema = z.object({ attachmentId: z.string().uuid() });
const CardIdSchema = z.object({ cardId: z.string().uuid() });
const UrlSchema = z.object({
  attachmentId: z.string().uuid(),
  disposition: z.enum(['inline', 'attachment']),
});

export async function requestCardAttachmentUpload(input: {
  cardId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<
  | {
      readonly ok: true;
      readonly attachmentId: string;
      readonly signedUrl: string;
      readonly token: string;
      readonly path: string;
    }
  | AttachmentActionError
> {
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) return fail('FORBIDDEN', VIEWER_READ_ONLY_MESSAGE);

  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) return INVALID();
  const { cardId, sizeBytes } = parsed.data;

  const card = await loadAccessibleCard(ctx, cardId);
  if (!card) return fail('NOT_FOUND', 'Carte introuvable.');

  const rl = await getRateLimiter('card_attachment_upload').check(ctx.userId);
  if (!rl.success) return RATE_LIMITED();

  const filename = sanitizeAttachmentFilename(parsed.data.filename);
  const contentType = parsed.data.contentType.toLowerCase();
  if (!isAllowedAttachment(filename, contentType)) {
    return fail('TYPE_NOT_ALLOWED', 'Type de fichier non autorisé.');
  }
  if (sizeBytes > CARD_ATTACHMENT_MAX_BYTES) {
    return fail('TOO_LARGE', 'Fichier trop volumineux (max 50 Mo).');
  }

  const existing = await prisma.cardAttachment.count({
    where: {
      workspaceId: ctx.workspaceId,
      cardId: card.id,
      scanStatus: { in: [...VISIBLE_STATUSES] },
    },
  });
  if (existing >= CARD_ATTACHMENT_MAX_PER_CARD) {
    return fail(
      'TOO_MANY',
      `Nombre maximal de pièces jointes atteint (${CARD_ATTACHMENT_MAX_PER_CARD}).`,
    );
  }

  const id = randomUUID();
  const path = cardAttachmentPath(ctx.workspaceId, card.id, id);
  const signed = await createCardAttachmentUploadUrl(path);
  if (!signed.ok) {
    // Jamais l'erreur Storage brute au client (infos d'infra, §4.7).
    return fail('UPLOAD_FAILED', "Impossible de préparer l'envoi. Réessaie.");
  }

  await prisma.cardAttachment.create({
    data: {
      id,
      workspaceId: ctx.workspaceId,
      cardId: card.id,
      uploadedById: ctx.userId,
      filename,
      contentType,
      sizeBytes,
      storagePath: path,
    },
  });

  return { ok: true, attachmentId: id, signedUrl: signed.signedUrl, token: signed.token, path };
}

export async function finalizeCardAttachment(input: {
  attachmentId: string;
}): Promise<{ readonly ok: true } | AttachmentActionError> {
  const ctx = await requireUser();
  const parsed = AttachmentIdSchema.safeParse(input);
  if (!parsed.success) return INVALID();

  const row = await prisma.cardAttachment.findFirst({
    where: {
      id: parsed.data.attachmentId,
      workspaceId: ctx.workspaceId,
      uploadedById: ctx.userId,
      scanStatus: 'pending',
    },
    select: { id: true },
  });
  if (!row) return NOT_FOUND();

  await inngestClient.send({ name: 'card-attachment/uploaded', data: { attachmentId: row.id } });
  return { ok: true };
}

export async function listCardAttachments(input: {
  cardId: string;
}): Promise<
  { readonly ok: true; readonly attachments: CardAttachmentDTO[] } | AttachmentActionError
> {
  const ctx = await requireUser();
  const parsed = CardIdSchema.safeParse(input);
  if (!parsed.success) return INVALID();

  const card = await loadAccessibleCard(ctx, parsed.data.cardId);
  if (!card) return fail('NOT_FOUND', 'Carte introuvable.');

  return { ok: true, attachments: await listCardAttachmentDTOs(ctx, card.id) };
}

export async function getCardAttachmentUrl(input: {
  attachmentId: string;
  disposition: 'inline' | 'attachment';
}): Promise<{ readonly ok: true; readonly url: string } | AttachmentActionError> {
  const ctx = await requireUser();
  const parsed = UrlSchema.safeParse(input);
  if (!parsed.success) return INVALID();

  const rl = await getRateLimiter('card_attachment_download').check(ctx.userId);
  if (!rl.success) return RATE_LIMITED();

  const row = await prisma.cardAttachment.findFirst({
    where: { id: parsed.data.attachmentId, workspaceId: ctx.workspaceId },
    select: { id: true, cardId: true, filename: true, storagePath: true, scanStatus: true },
  });
  if (!row) return NOT_FOUND();
  if (!(await loadAccessibleCard(ctx, row.cardId))) return NOT_FOUND();
  if (row.scanStatus !== 'clean') {
    return fail('NOT_READY', 'Fichier en cours d’analyse ou indisponible.');
  }

  const signed = await getCardAttachmentSignedUrl(
    row.storagePath,
    parsed.data.disposition === 'attachment' ? { download: row.filename } : {},
  );
  if (!signed.ok) return fail('URL_FAILED', 'Lien indisponible. Réessaie.');
  return { ok: true, url: signed.signedUrl };
}

export async function deleteCardAttachment(input: {
  attachmentId: string;
}): Promise<{ readonly ok: true } | AttachmentActionError> {
  const ctx = await requireUser();
  const parsed = AttachmentIdSchema.safeParse(input);
  if (!parsed.success) return INVALID();

  const row = await prisma.cardAttachment.findFirst({
    where: { id: parsed.data.attachmentId, workspaceId: ctx.workspaceId },
    select: {
      id: true,
      cardId: true,
      uploadedById: true,
      contentType: true,
      sizeBytes: true,
      storagePath: true,
    },
  });
  if (!row) return NOT_FOUND();
  if (!(await loadAccessibleCard(ctx, row.cardId))) return NOT_FOUND();
  if (!canDeleteAttachment(ctx, row.uploadedById)) {
    return fail(
      'FORBIDDEN',
      ctx.role === Roles.Viewer
        ? VIEWER_READ_ONLY_MESSAGE
        : "Seul l'auteur ou un Admin peut supprimer cette pièce jointe.",
    );
  }

  await removeCardAttachment(row.storagePath);
  // deleteMany pour garder le filtre workspace dans le WHERE (§4.4.2).
  await prisma.cardAttachment.deleteMany({ where: { id: row.id, workspaceId: ctx.workspaceId } });
  await prisma.auditLog.create({
    data: {
      action: 'card_attachment_deleted',
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      subjectType: 'card_attachment',
      subjectId: row.id,
      // Jamais le nom de fichier (§4.7) — type + taille seulement.
      data: { contentType: row.contentType, sizeBytes: row.sizeBytes },
    },
  });
  return { ok: true };
}
