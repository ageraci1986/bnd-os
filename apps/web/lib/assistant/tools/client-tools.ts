import 'server-only';

import { z } from 'zod';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import { prisma } from '@nexushub/db';
import {
  CLIENT_COLOR_TOKENS,
  RACI_VALUES,
  computeInitials,
  parseDomainList,
  validateInitials,
} from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import { loadUserScope, scopedClientWhere } from '@/lib/auth/scope';
import {
  createClientCore,
  createContactCore,
  deleteClientCore,
  deleteContactCore,
  updateClientCore,
  updateContactCore,
} from '@/features/clients/lib/client-core';
import { safeMutation } from './safe-wrappers';

const uuid = z.string().uuid();
const UUID_JSON = { type: 'string', format: 'uuid' } as const;

/**
 * Bornes reprises des schémas source (`features/clients/lib/schemas.ts`) —
 * PAS le garde-fou pré-trim (`max(120)` sur le nom) mais la borne réelle
 * appliquée par le domain (`CLIENT_NAME_MAX` dans
 * `packages/domain/src/clients/index.ts`, non exportée).
 */
const CLIENT_NAME_MAX = 80;
const CONTACT_NAME_MAX = 80;
const JOB_TITLE_MAX = 120;
const CONTACT_EMAIL_MAX = 254;
const PHONE_MAX = 40;
const NOTES_MAX = 2000;
/** `DomainsSchema` du feature ne borne que la longueur de la chaîne brute (2048) ; on plafonne ici le nombre d'entrées pour rester raisonnable côté tool. */
const DOMAINS_MAX_ITEMS = 30;
const DOMAIN_ITEM_MAX_CHARS = 253;
const RACI_JSON = { type: ['string', 'null'], enum: [...RACI_VALUES] } as const;

/**
 * Reformule un échec `{ok:false, message}` en message montrable. Contrat
 * `defineTool` : seul un texte user-safe peut s'échapper d'un handler.
 */
function failure(message: string): string {
  return `Échec : ${message}`;
}

/**
 * Valide/normalise des initiales (même règle que `InitialsSchema` du
 * feature) — utilisée quand des initiales sont explicitement fournies par le
 * modèle. Contrairement au fallback silencieux du schéma feature (pensé pour
 * une UI qui contraint déjà la saisie), le tool ÉCHOUE explicitement sur des
 * initiales invalides plutôt que de les stocker telles quelles.
 */
function normalizeInitialsOrFail(
  raw: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string } {
  const validated = validateInitials(raw);
  if (validated.ok) return { ok: true, value: validated.value };
  const messages = {
    EMPTY: 'Initiales requises.',
    TOO_LONG: 'Initiales trop longues (max 4 caractères).',
    INVALID_CHARS: 'Initiales invalides : lettres et chiffres uniquement.',
  } as const;
  return { ok: false, message: messages[validated.code] };
}

/**
 * Valide/normalise une liste de domaines (même règle que `DomainsSchema` du
 * feature, via `parseDomainList` du domain — dédoublonnage, minuscule,
 * validation de format). Le tool reçoit un tableau (plus naturel pour le
 * modèle qu'une chaîne séparée par virgules) qu'on rejoint avant de
 * déléguer à la validation domain.
 */
function normalizeDomainsOrFail(
  raw: readonly string[],
):
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly message: string } {
  const parsed = parseDomainList(raw.join(' '));
  if (!parsed.ok) return { ok: false, message: 'Domaine invalide (ex : acme.com).' };
  return { ok: true, value: parsed.value };
}

const domainsToolSchema = z
  .array(z.string().trim().min(1).max(DOMAIN_ITEM_MAX_CHARS))
  .max(DOMAINS_MAX_ITEMS);

const domainsJson = {
  type: 'array' as const,
  items: { type: 'string', maxLength: DOMAIN_ITEM_MAX_CHARS },
  maxItems: DOMAINS_MAX_ITEMS,
  description:
    'Domaines email associés au client (ex: ["acme.com"]) — pour le rattachement Exchange automatique.',
};

/**
 * Volontairement SANS `.transform()` : la normalisation (minuscule) vit dans
 * les handlers, pas dans le schéma — convention du repo (voir kanban-tools),
 * les tests appellent `handler()` directement en contournant `safeParse`.
 */
const contactEmailSchema = z.string().trim().max(CONTACT_EMAIL_MAX).email('E-mail invalide');

/**
 * Tools mutants Clients + Contacts (Plan 5b Task 3). Wrappent les cores
 * `features/clients/lib/client-core.ts` — aucune logique métier ici,
 * uniquement la traduction schéma Zod ↔ résultat `{ok}` ↔ message montrable.
 * `ctx` est lié à la construction (jamais fourni par le modèle) : voir
 * `tools/index.ts`.
 *
 * Les deux suppressions (`delete_client`, `delete_contact`) sont gated et
 * suivent le pattern `describeForConfirm` véridique de `kanban-tools.ts` :
 * re-parse Zod de l'input BRUT en tête (input invalide/objet structuré →
 * libellé prudent SANS aucun appel DB), scope filtré via la closure `ctx`
 * (hors-scope → même libellé que l'inexistant, jamais le nom réel), puis
 * lecture véridique en DB pour le libellé final.
 */
export function buildClientTools(ctx: AuthContext): ToolSpec[] {
  return [
    defineTool({
      name: 'create_client',
      description:
        'Crée un client dans le workspace. Les initiales sont auto-dérivées du nom si omises. domains associe des domaines email au client (rattachement Exchange automatique).',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(CLIENT_NAME_MAX),
        colorToken: z.enum(CLIENT_COLOR_TOKENS),
        initials: z.string().trim().max(4).optional(),
        domains: domainsToolSchema.optional(),
        notes: z.string().max(NOTES_MAX).optional(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: CLIENT_NAME_MAX },
          colorToken: { type: 'string', enum: [...CLIENT_COLOR_TOKENS] },
          initials: {
            type: 'string',
            maxLength: 4,
            description: 'Auto-dérivées du nom si omises.',
          },
          domains: domainsJson,
          notes: { type: 'string', maxLength: NOTES_MAX },
        },
        required: ['name', 'colorToken'],
      },
      handler: async (input) =>
        safeMutation('create_client', async () => {
          const rawInitials = input.initials?.trim() ?? '';
          let initials: string;
          if (rawInitials.length === 0) {
            initials = computeInitials(input.name) || input.name.slice(0, 2).toUpperCase();
          } else {
            const norm = normalizeInitialsOrFail(rawInitials);
            if (!norm.ok) return failure(norm.message);
            initials = norm.value;
          }

          let domains: string[] = [];
          if (input.domains !== undefined && input.domains.length > 0) {
            const norm = normalizeDomainsOrFail(input.domains);
            if (!norm.ok) return failure(norm.message);
            domains = [...norm.value];
          }

          const notes =
            input.notes !== undefined && input.notes.trim().length > 0 ? input.notes.trim() : null;

          const result = await createClientCore(ctx, {
            name: input.name,
            colorToken: input.colorToken,
            initials,
            domains,
            notes,
          });
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ created: true, clientId: result.clientId, slug: result.slug });
        }),
    }),

    defineTool({
      name: 'update_client',
      description:
        "Met à jour le nom, la couleur, les initiales, les domaines ou les notes d'un client. Les champs non fournis restent inchangés ; notes: null efface les notes.",
      inputSchema: z.object({
        clientId: uuid,
        name: z.string().trim().min(1).max(CLIENT_NAME_MAX).optional(),
        colorToken: z.enum(CLIENT_COLOR_TOKENS).optional(),
        initials: z.string().trim().max(4).optional(),
        domains: domainsToolSchema.optional(),
        notes: z.string().max(NOTES_MAX).nullable().optional(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          clientId: UUID_JSON,
          name: { type: 'string', maxLength: CLIENT_NAME_MAX },
          colorToken: { type: 'string', enum: [...CLIENT_COLOR_TOKENS] },
          initials: { type: 'string', maxLength: 4 },
          domains: domainsJson,
          notes: { type: ['string', 'null'], maxLength: NOTES_MAX },
        },
        required: ['clientId'],
      },
      handler: async (input) =>
        safeMutation('update_client', async () => {
          let initials: string | undefined;
          if (input.initials !== undefined) {
            const norm = normalizeInitialsOrFail(input.initials.trim());
            if (!norm.ok) return failure(norm.message);
            initials = norm.value;
          }

          let domains: string[] | undefined;
          if (input.domains !== undefined) {
            const norm = normalizeDomainsOrFail(input.domains);
            if (!norm.ok) return failure(norm.message);
            domains = [...norm.value];
          }

          // Conditional-spread (exactOptionalPropertyTypes) : même rationnel
          // que update_card/update_project dans kanban-tools.ts.
          const result = await updateClientCore(ctx, {
            clientId: input.clientId,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.colorToken !== undefined ? { colorToken: input.colorToken } : {}),
            ...(initials !== undefined ? { initials } : {}),
            ...(domains !== undefined ? { domains } : {}),
            ...(input.notes !== undefined
              ? {
                  notes:
                    input.notes !== null && input.notes.trim().length > 0
                      ? input.notes.trim()
                      : null,
                }
              : {}),
          });
          if (!result.ok) return failure(result.message);
          // Post-état RELU par le core lui-même (spec V2 §3.1).
          return JSON.stringify({
            updated: true,
            name: result.name,
            colorToken: result.colorToken,
            initials: result.initials,
            domains: result.domains,
            notes: result.notes,
          });
        }),
    }),

    defineTool({
      name: 'delete_client',
      description:
        "Supprime un client (ADR §10 #14 : refusé s'il a des projets actifs). Ses contacts sont supprimés dans la même opération. Action sensible : confirmation utilisateur requise.",
      inputSchema: z.object({ clientId: uuid }),
      jsonSchema: { type: 'object', properties: { clientId: UUID_JSON }, required: ['clientId'] },
      gated: true,
      // Anti-spoofing (types.ts) : l'input arrive BRUT, avant validation Zod —
      // on ne fait jamais confiance à un nom fourni par le modèle. Le nom et
      // le compte de projets actifs affichés dans le dialog sont RELUS en
      // DB, scopés au workspace courant via la closure `ctx`.
      describeForConfirm: async (input: unknown) => {
        // Re-parse local OBLIGATOIRE (même rationnel que delete_project) :
        // sans lui, Prisma 6 ignore `id: undefined` et accepte un objet
        // structuré comme filtre — le dialog pourrait nommer un autre objet
        // que celui réellement supprimé.
        const parsed = z.object({ clientId: uuid }).safeParse(input);
        if (!parsed.success) return 'Supprimer un client introuvable dans ce workspace ?';
        // Même filtrage scope que les tools de lecture : un restricted ne
        // doit pas apprendre le nom/compte d'un client hors de son scope via
        // le dialog. Hors scope → même texte que l'inexistant.
        const scope = await loadUserScope(ctx);
        const client = await prisma.client.findFirst({
          where: {
            AND: [
              { id: parsed.data.clientId, workspaceId: ctx.workspaceId, deletedAt: null },
              scopedClientWhere(scope),
            ],
          },
          select: {
            name: true,
            _count: { select: { projects: { where: { deletedAt: null, archivedAt: null } } } },
          },
        });
        if (client === null) return 'Supprimer un client introuvable dans ce workspace ?';
        const n = client._count.projects;
        if (n > 0) {
          return `Supprimer le client « ${client.name} » ? Attention : ${n} projet(s) actif(s) y sont attachés — la suppression sera refusée.`;
        }
        return `Supprimer le client « ${client.name} » (aucun projet actif) ? Ses contacts seront aussi supprimés.`;
      },
      handler: async (input) =>
        safeMutation('delete_client', async () => {
          // Pas d'ip/userAgent : la boucle agent n'a pas de requête HTTP
          // exploitable ici — le core les rend optionnels précisément pour
          // ce cas (voir DeleteClientCoreInput).
          const result = await deleteClientCore(ctx, { clientId: input.clientId });
          return result.ok ? 'Client supprimé.' : failure(result.message);
        }),
    }),

    defineTool({
      name: 'create_contact',
      description:
        'Crée un contact rattaché à un client (utiliser list_clients pour trouver le clientId). raci (optionnel) : responsible/approver/consulted/informed — global au contact, pas par projet.',
      inputSchema: z.object({
        clientId: uuid,
        firstName: z.string().trim().min(1).max(CONTACT_NAME_MAX),
        lastName: z.string().trim().min(1).max(CONTACT_NAME_MAX),
        jobTitle: z.string().trim().max(JOB_TITLE_MAX).optional(),
        email: contactEmailSchema.optional(),
        phone: z.string().trim().max(PHONE_MAX).optional(),
        raci: z.enum(RACI_VALUES).nullable().optional(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          clientId: UUID_JSON,
          firstName: { type: 'string', maxLength: CONTACT_NAME_MAX },
          lastName: { type: 'string', maxLength: CONTACT_NAME_MAX },
          jobTitle: { type: 'string', maxLength: JOB_TITLE_MAX },
          email: { type: 'string', format: 'email', maxLength: CONTACT_EMAIL_MAX },
          phone: { type: 'string', maxLength: PHONE_MAX },
          raci: RACI_JSON,
        },
        required: ['clientId', 'firstName', 'lastName'],
      },
      handler: async (input) =>
        safeMutation('create_contact', async () => {
          const result = await createContactCore(ctx, {
            clientId: input.clientId,
            name: { firstName: input.firstName, lastName: input.lastName },
            jobTitle: input.jobTitle ?? null,
            email: input.email !== undefined ? input.email.toLowerCase() : null,
            phone: input.phone ?? null,
            raci: input.raci ?? null,
            notes: null,
          });
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ created: true, contactId: result.contactId });
        }),
    }),

    defineTool({
      name: 'update_contact',
      description:
        "Met à jour le prénom, nom, poste, email, téléphone ou RACI d'un contact. Les champs non fournis restent inchangés ; jobTitle/email/phone/raci: null efface le champ correspondant.",
      inputSchema: z.object({
        contactId: uuid,
        firstName: z.string().trim().min(1).max(CONTACT_NAME_MAX).optional(),
        lastName: z.string().trim().min(1).max(CONTACT_NAME_MAX).optional(),
        jobTitle: z.string().trim().max(JOB_TITLE_MAX).nullable().optional(),
        email: contactEmailSchema.nullable().optional(),
        phone: z.string().trim().max(PHONE_MAX).nullable().optional(),
        raci: z.enum(RACI_VALUES).nullable().optional(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          contactId: UUID_JSON,
          firstName: { type: 'string', maxLength: CONTACT_NAME_MAX },
          lastName: { type: 'string', maxLength: CONTACT_NAME_MAX },
          jobTitle: { type: ['string', 'null'], maxLength: JOB_TITLE_MAX },
          email: { type: ['string', 'null'], format: 'email', maxLength: CONTACT_EMAIL_MAX },
          phone: { type: ['string', 'null'], maxLength: PHONE_MAX },
          raci: RACI_JSON,
        },
        required: ['contactId'],
      },
      handler: async (input) =>
        safeMutation('update_contact', async () => {
          // Conditional-spread (exactOptionalPropertyTypes) : même rationnel
          // que update_card/update_project dans kanban-tools.ts.
          const result = await updateContactCore(ctx, {
            contactId: input.contactId,
            ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
            ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
            ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
            ...(input.email !== undefined
              ? { email: input.email === null ? null : input.email.toLowerCase() }
              : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.raci !== undefined ? { raci: input.raci } : {}),
          });
          if (!result.ok) return failure(result.message);
          // Post-état RELU par le core lui-même (spec V2 §3.1).
          return JSON.stringify({
            updated: true,
            firstName: result.firstName,
            lastName: result.lastName,
            raci: result.raci,
            email: result.email,
          });
        }),
    }),

    defineTool({
      name: 'delete_contact',
      description: 'Supprime un contact. Action sensible : confirmation utilisateur requise.',
      inputSchema: z.object({ contactId: uuid }),
      jsonSchema: {
        type: 'object',
        properties: { contactId: UUID_JSON },
        required: ['contactId'],
      },
      gated: true,
      describeForConfirm: async (input: unknown) => {
        // Re-parse local OBLIGATOIRE (même rationnel que delete_client).
        const parsed = z.object({ contactId: uuid }).safeParse(input);
        if (!parsed.success) return 'Supprimer un contact introuvable dans ce workspace ?';
        // Scope restricted appliqué via le join client (même filtrage que
        // scopedCardWhere via `project:` dans lib/auth/scope.ts) ; hors
        // scope → même texte que l'inexistant.
        const scope = await loadUserScope(ctx);
        const contact = await prisma.contact.findFirst({
          where: {
            id: parsed.data.contactId,
            workspaceId: ctx.workspaceId,
            deletedAt: null,
            client: {
              AND: [{ workspaceId: ctx.workspaceId, deletedAt: null }, scopedClientWhere(scope)],
            },
          },
          select: { firstName: true, lastName: true, client: { select: { name: true } } },
        });
        if (contact === null) return 'Supprimer un contact introuvable dans ce workspace ?';
        return `Supprimer le contact « ${contact.firstName} ${contact.lastName} » (client « ${contact.client.name} ») ?`;
      },
      handler: async (input) =>
        safeMutation('delete_contact', async () => {
          const result = await deleteContactCore(ctx, { contactId: input.contactId });
          return result.ok ? 'Contact supprimé.' : failure(result.message);
        }),
    }),

    defineTool({
      name: 'set_contact_raci',
      description:
        "Définit ou efface (null) le rôle RACI d'un contact. Le RACI est global au contact (pas par projet).",
      inputSchema: z.object({
        contactId: uuid,
        raci: z.enum(RACI_VALUES).nullable(),
      }),
      jsonSchema: {
        type: 'object',
        properties: { contactId: UUID_JSON, raci: RACI_JSON },
        required: ['contactId', 'raci'],
      },
      handler: async (input) =>
        safeMutation('set_contact_raci', async () => {
          const result = await updateContactCore(ctx, {
            contactId: input.contactId,
            raci: input.raci,
          });
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ updated: true, raci: result.raci });
        }),
    }),
  ];
}
