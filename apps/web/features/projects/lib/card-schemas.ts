import { z } from 'zod';

const titleSchema = z
  .string()
  .min(1, 'Titre requis')
  .max(160, 'Titre trop long (max 160)')
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, 'Titre requis');

export const CreateCardSchema = z.object({
  projectId: z.string().uuid(),
  columnId: z.string().uuid(),
  title: titleSchema,
});

export const MoveCardSchema = z.object({
  cardId: z.string().uuid(),
  targetColumnId: z.string().uuid(),
  /** Index in the target column's ordered card list (0-based). */
  targetIndex: z.coerce.number().int().min(0),
});

export const DeleteCardSchema = z.object({
  cardId: z.string().uuid(),
});
