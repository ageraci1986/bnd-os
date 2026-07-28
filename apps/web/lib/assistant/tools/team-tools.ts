import 'server-only';

import { z } from 'zod';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import { prisma } from '@nexushub/db';
import { Roles, type Role } from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import {
  changeMemberRoleCore,
  inviteMemberCore,
  removeMemberCore,
} from '@/features/team/lib/team-core';
import { safeMutation } from './safe-wrappers';

const uuid = z.string().uuid();
const UUID_JSON = { type: 'string', format: 'uuid' } as const;

const EMAIL_MIN = 3;
const EMAIL_MAX = 254;

/**
 * Rôles proposés à `invite_member` : PAS de Viewer — `inviteMemberCore`
 * refuse aussi ce cas (un Viewer a besoin d'un scope client/projet choisi
 * dans le picker de l'interface Équipe, qu'un appel de tool n'a pas).
 * `change_member_role`, lui, garde les 3 rôles : `changeMemberRoleCore`
 * gère un passage en Viewer avec un message précis quand le membre n'a
 * pas encore de scope — laisser passer au core plutôt que le refuser ici.
 */
const INVITE_ROLE_ENUM = [Roles.Admin, Roles.User] as const;
const MEMBER_ROLE_ENUM = [Roles.Admin, Roles.User, Roles.Viewer] as const;

/**
 * Reformule un échec `{ok:false, message}` en message montrable. Contrat
 * `defineTool` : seul un texte user-safe peut s'échapper d'un handler.
 */
function failure(message: string): string {
  return `Échec : ${message}`;
}

/** Libellés affichés dans les dialogs de confirmation — alignés sur les `<option>` de member-row.tsx / pending-invitation-row.tsx. */
function roleLabel(role: Role): string {
  switch (role) {
    case Roles.Admin:
      return 'Admin';
    case Roles.User:
      return 'User';
    case Roles.Viewer:
      return 'Viewer';
  }
}

const InviteMemberInputSchema = z.object({
  email: z.string().trim().min(EMAIL_MIN).max(EMAIL_MAX),
  role: z.enum(INVITE_ROLE_ENUM),
});

const ChangeMemberRoleInputSchema = z.object({
  userId: uuid,
  role: z.enum(MEMBER_ROLE_ENUM),
});

const RemoveMemberInputSchema = z.object({ userId: uuid });

const CHANGE_ROLE_NOT_FOUND = "Changer le rôle d'un membre introuvable dans ce workspace ?";
const REMOVE_NOT_FOUND = "Retirer un membre introuvable de l'espace de travail ?";

/**
 * Tools équipe (Plan 5b Task 5) — PREMIERS `adminOnly: true` du registry.
 * `run-turn.ts` refuse tout appel de ces tools par un rôle != 'admin' AVANT
 * même le gate de confirmation (refus dur, pas d'exécution, pas de dialog) —
 * mais chaque core (`features/team/lib/team-core.ts`) revérifie
 * indépendamment `ctx.role === Roles.Admin` en tête (défense en profondeur,
 * jamais confiance dans le seul flag du registry).
 *
 * DÉCISION DE REVUE SÉCURITÉ (remplace le plan initial) : les 3 tools sont
 * TOUS gated, y compris `change_member_role` — une promotion vers Admin via
 * prompt-injection est la plus grosse escalade atteignable par ce registry ;
 * `invite_member role: 'admin'` et `remove_member` méritent la même
 * confirmation explicite qu'une suppression.
 *
 * Pattern `describeForConfirm` véridique, identique à kanban-tools.ts /
 * client-tools.ts : re-parse Zod de l'input BRUT en tête (invalide → libellé
 * prudent SANS aucun appel DB), lookup véridique en DB via la closure `ctx`
 * pour les deux tools qui identifient un membre existant, phrasé déclaratif
 * pour les cas voués au refus (retrait de soi-même).
 */
export function buildTeamTools(ctx: AuthContext): ToolSpec[] {
  return [
    defineTool({
      name: 'invite_member',
      description:
        "Invite un membre dans le workspace par email (rôle admin ou user — pour un Viewer avec scope, utiliser l'interface Équipe). Un email d'invitation valide 72 h est envoyé ; toute invitation en attente pour cette adresse est remplacée. Action sensible : confirmation utilisateur requise.",
      inputSchema: InviteMemberInputSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', minLength: EMAIL_MIN, maxLength: EMAIL_MAX },
          role: { type: 'string', enum: [...INVITE_ROLE_ENUM] },
        },
        required: ['email', 'role'],
      },
      adminOnly: true,
      gated: true,
      // L'input EST l'action : pas de lookup DB nécessaire, mais un
      // safeParse quand même — un input structuré/invalide ne doit jamais
      // produire un libellé qui laisse deviner une valeur brute non
      // normalisée. L'email affiché est normalisé COMME le core
      // (trim + lowercase) : ce que l'utilisateur approuve == ce que
      // `inviteMemberCore` enverra.
      describeForConfirm: (input: unknown) => {
        const parsed = InviteMemberInputSchema.safeParse(input);
        if (!parsed.success) return 'Inviter un membre ? (données invalides)';
        const email = parsed.data.email.toLowerCase();
        if (parsed.data.role === Roles.Admin) {
          return `Inviter ${email} comme ADMINISTRATEUR (accès complet : membres, intégrations, suppressions) ? Un email d'invitation (valide 72 h) lui sera envoyé.`;
        }
        return `Inviter ${email} comme membre ? Un email d'invitation (valide 72 h) lui sera envoyé ; toute invitation en attente pour cette adresse sera remplacée.`;
      },
      handler: async (input) =>
        safeMutation('invite_member', async () => {
          const result = await inviteMemberCore(ctx, { email: input.email, role: input.role });
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ invited: true, email: result.email, role: result.role });
        }),
    }),

    defineTool({
      name: 'change_member_role',
      description:
        "Change le rôle d'un membre du workspace (admin / user / viewer). Passer un membre en Viewer sans scope déjà défini est refusé — utiliser l'interface Équipe pour lui attribuer un scope au préalable. Action sensible : confirmation utilisateur requise.",
      inputSchema: ChangeMemberRoleInputSchema,
      jsonSchema: {
        type: 'object',
        properties: { userId: UUID_JSON, role: { type: 'string', enum: [...MEMBER_ROLE_ENUM] } },
        required: ['userId', 'role'],
      },
      adminOnly: true,
      gated: true,
      // Anti-spoofing (types.ts) : l'input arrive BRUT, avant validation Zod
      // du registry — re-parse local obligatoire. Le membre visé est RELU en
      // DB (workspace-scopé, clé composée `workspaceId_userId`) plutôt que
      // pris tel quel sur l'input.
      describeForConfirm: async (input: unknown) => {
        const parsed = ChangeMemberRoleInputSchema.safeParse(input);
        if (!parsed.success) return CHANGE_ROLE_NOT_FOUND;

        const target = await prisma.membership.findUnique({
          where: {
            workspaceId_userId: { workspaceId: ctx.workspaceId, userId: parsed.data.userId },
          },
          select: { role: true, user: { select: { firstName: true } } },
        });
        if (target === null) return CHANGE_ROLE_NOT_FOUND;

        const from = roleLabel(target.role);
        const to = roleLabel(parsed.data.role);

        // Auto-modification : cas distinct AVANT le libellé nominal — le
        // modèle qui agit sur son propre userId perd potentiellement ses
        // propres outils d'administration en cours de tour.
        if (parsed.data.userId === ctx.userId) {
          return `Changer VOTRE PROPRE rôle : ${from} → ${to} ? Vous perdrez vos outils d'administration à la fin de ce tour.`;
        }

        const name = target.user.firstName ?? 'ce membre';
        const adminWarning =
          parsed.data.role === Roles.Admin
            ? ' Ce membre aura un accès administrateur complet.'
            : '';
        return `Changer le rôle de ${name} : ${from} → ${to} ?${adminWarning}`;
      },
      handler: async (input) =>
        safeMutation('change_member_role', async () => {
          const result = await changeMemberRoleCore(ctx, {
            userId: input.userId,
            role: input.role,
          });
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ updated: true, role: result.role });
        }),
    }),

    defineTool({
      name: 'remove_member',
      description:
        'Retire un membre du workspace. Un Admin ne peut pas se retirer lui-même (protection du dernier Admin). Action sensible : confirmation utilisateur requise.',
      inputSchema: RemoveMemberInputSchema,
      jsonSchema: {
        type: 'object',
        properties: { userId: UUID_JSON },
        required: ['userId'],
      },
      adminOnly: true,
      gated: true,
      describeForConfirm: async (input: unknown) => {
        const parsed = RemoveMemberInputSchema.safeParse(input);
        if (!parsed.success) return REMOVE_NOT_FOUND;

        // Cas voué au refus (mêmes rationnel + ordre que `removeMemberCore` :
        // vérifié AVANT le lookup, il n'en a jamais besoin) — phrase
        // DÉCLARATIVE, pas une question, même précédent que delete_client
        // avec projets actifs / delete_column sur « Bloqué ».
        if (parsed.data.userId === ctx.userId) {
          return "Vous ne pouvez pas vous retirer vous-même — l'action sera refusée.";
        }

        const target = await prisma.membership.findUnique({
          where: {
            workspaceId_userId: { workspaceId: ctx.workspaceId, userId: parsed.data.userId },
          },
          select: { role: true, user: { select: { firstName: true } } },
        });
        if (target === null) return REMOVE_NOT_FOUND;

        const name = target.user.firstName ?? 'ce membre';
        return `Retirer ${name} (${roleLabel(target.role)}) de l'espace de travail ?`;
      },
      handler: async (input) =>
        safeMutation('remove_member', async () => {
          const result = await removeMemberCore(ctx, { userId: input.userId });
          return result.ok ? "Membre retiré de l'espace." : failure(result.message);
        }),
    }),
  ];
}
