/**
 * Zod schemas for the project create wizard. Wraps the pure-TS
 * validators from `@nexushub/domain/projects` so the UI gets the same
 * error semantics as the server (EMPTY / TOO_LONG / END_BEFORE_START).
 */
import { z } from 'zod';
import {
  BUILTIN_TEMPLATES,
  BUILTIN_PROJECT_TYPES,
  validateProjectDates,
  validateProjectName,
} from '@nexushub/domain';

const NameSchema = z
  .string()
  .max(160)
  .transform((raw) => validateProjectName(raw))
  .superRefine((res, ctx) => {
    if (res.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: res.code === 'EMPTY' ? 'Nom requis' : 'Nom trop long (max 120 caractères)',
    });
  })
  .transform((res) => (res.ok ? res.value : ''));

const DateSchema = z
  .string()
  .optional()
  .transform((v) => {
    if (!v || v.trim().length === 0) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  });

// The wizard accepts EITHER a hard-coded built-in template id (one of
// BUILTIN_TEMPLATES) OR a workspace-defined Kanban template UUID. The
// server action (createProject) discriminates between the two and
// resolves the columns + step-checklists accordingly.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUILTIN_IDS = BUILTIN_TEMPLATES.map((t) => t.id);
const TemplateIdSchema = z
  .string()
  .refine((value) => UUID_RE.test(value) || BUILTIN_IDS.includes(value), {
    message: 'Template Kanban inconnu.',
  });

const TypeIdSchema = z
  .enum(BUILTIN_PROJECT_TYPES.map((t) => t.id) as [string, ...string[]])
  .optional()
  .nullable();

const DescriptionSchema = z
  .string()
  .max(2000)
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

export const CreateProjectSchema = z
  .object({
    name: NameSchema,
    clientId: z.string().uuid('Client requis'),
    description: DescriptionSchema,
    startDate: DateSchema,
    endDate: DateSchema,
    typeId: TypeIdSchema,
    templateId: TemplateIdSchema,
  })
  .superRefine((data, ctx) => {
    const dates = validateProjectDates({
      startDate: data.startDate,
      endDate: data.endDate,
    });
    if (!dates.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'La date de fin doit être après la date de début',
      });
    }
  });

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
