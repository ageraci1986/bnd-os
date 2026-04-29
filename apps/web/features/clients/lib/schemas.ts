/**
 * Zod schemas shared between Server Actions and any future API surface.
 *
 * They wrap the pure-TS validators from `@nexushub/domain/clients` so the
 * UI gets the same error semantics as the server (e.g. EMPTY / TOO_LONG /
 * INVALID_DOMAIN) without having to know about Prisma.
 */
import { z } from 'zod';
import {
  CLIENT_COLOR_TOKENS,
  RACI_VALUES,
  computeInitials,
  parseDomainList,
  validateClientName,
  validateContactName,
  validateInitials,
} from '@nexushub/domain';

const ClientColorSchema = z.enum(CLIENT_COLOR_TOKENS);

const ClientNameSchema = z
  .string()
  .max(120) // pre-trim guard
  .transform((raw) => validateClientName(raw))
  .superRefine((res, ctx) => {
    if (res.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: res.code === 'EMPTY' ? 'Nom requis' : 'Nom trop long (max 80 caractères)',
    });
  })
  .transform((res) => (res.ok ? res.value : ''));

const InitialsSchema = z
  .string()
  .max(8)
  .transform((raw) => validateInitials(raw))
  .superRefine((res, ctx) => {
    if (res.ok) return;
    const messages = {
      EMPTY: 'Initiales requises',
      TOO_LONG: 'Maximum 4 caractères',
      INVALID_CHARS: 'Lettres et chiffres uniquement',
    } as const;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: messages[res.code],
    });
  })
  .transform((res) => (res.ok ? res.value : ''));

const DomainsSchema = z
  .string()
  .max(2048)
  .default('')
  .transform((raw) => parseDomainList(raw))
  .superRefine((res, ctx) => {
    if (res.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Domaine invalide (ex : acme.com)',
    });
  })
  .transform((res) => (res.ok ? [...res.value] : []));

const NotesSchema = z
  .string()
  .max(2000)
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

/**
 * Used by `createClient`. Initials are auto-derived from the name when the
 * caller leaves the field empty.
 */
export const CreateClientSchema = z
  .object({
    name: ClientNameSchema,
    colorToken: ClientColorSchema,
    initials: z.string().default(''),
    domains: DomainsSchema,
    notes: NotesSchema,
  })
  .transform((v) => {
    if (v.initials.trim().length === 0) {
      return { ...v, initials: computeInitials(v.name) || v.name.slice(0, 2).toUpperCase() };
    }
    const validated = validateInitials(v.initials);
    return { ...v, initials: validated.ok ? validated.value : v.initials };
  });

export type CreateClientInput = z.infer<typeof CreateClientSchema>;

export const UpdateClientSchema = z.object({
  clientId: z.string().uuid(),
  name: ClientNameSchema,
  colorToken: ClientColorSchema,
  initials: InitialsSchema,
  domains: DomainsSchema,
  notes: NotesSchema,
});

export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;

export const DeleteClientSchema = z.object({
  clientId: z.string().uuid(),
});

// ---------- Contacts -------------------------------------------------------

const ContactNameSchema = z
  .object({
    firstName: z.string().max(80),
    lastName: z.string().max(80),
  })
  .transform((v) => validateContactName(v))
  .superRefine((res, ctx) => {
    if (res.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: res.code === 'FIRST_NAME_EMPTY' ? ['firstName'] : ['lastName'],
      message: res.code === 'FIRST_NAME_EMPTY' ? 'Prénom requis' : 'Nom requis',
    });
  })
  .transform((res) => (res.ok ? res.value : { firstName: '', lastName: '' }));

const optionalNullableString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

export const CreateContactSchema = z.object({
  clientId: z.string().uuid(),
  name: ContactNameSchema,
  jobTitle: optionalNullableString(120),
  email: z
    .string()
    .max(254)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim().toLowerCase() : null))
    .pipe(z.string().email('E-mail invalide').nullable().or(z.null())),
  phone: optionalNullableString(40),
  raci: z.enum(RACI_VALUES).nullable().optional(),
  notes: optionalNullableString(2000),
});

export type CreateContactInput = z.infer<typeof CreateContactSchema>;

export const UpdateContactSchema = CreateContactSchema.extend({
  contactId: z.string().uuid(),
}).omit({ clientId: true });

export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;

export const DeleteContactSchema = z.object({
  contactId: z.string().uuid(),
});
