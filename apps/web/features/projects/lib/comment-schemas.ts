/**
 * Zod schemas shared by the three comment Server Actions. Body limits
 * come from the spec: 1 to 10_000 chars trimmed, no all-whitespace.
 */
import { z } from 'zod';

export const COMMENT_BODY_MAX = 10_000;

const bodySchema = z
  .string()
  .trim()
  .min(1, 'Le commentaire ne peut pas être vide.')
  .max(COMMENT_BODY_MAX, `Maximum ${COMMENT_BODY_MAX} caractères.`);

export const CreateCommentSchema = z.object({
  cardId: z.string().uuid(),
  body: bodySchema,
});

export const UpdateCommentSchema = z.object({
  commentId: z.string().uuid(),
  body: bodySchema,
});

export const DeleteCommentSchema = z.object({
  commentId: z.string().uuid(),
});
