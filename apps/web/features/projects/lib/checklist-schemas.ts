import { z } from 'zod';

export const CreateChecklistItemSchema = z.object({
  cardId: z.string().uuid(),
  title: z
    .string()
    .min(1, 'Titre requis')
    .max(200, 'Titre trop long')
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, 'Titre requis'),
});

export const ToggleChecklistItemSchema = z.object({
  itemId: z.string().uuid(),
  isChecked: z.coerce.boolean(),
});

export const DeleteChecklistItemSchema = z.object({
  itemId: z.string().uuid(),
});

export const AdvanceCardSchema = z.object({
  cardId: z.string().uuid(),
});

export const SkipCardSchema = z.object({
  cardId: z.string().uuid(),
});

export const UpdateCardDueDateSchema = z.object({
  cardId: z.string().uuid(),
  /** Empty string clears the due date. */
  dueDate: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || v.trim().length === 0) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }),
});
