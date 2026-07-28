import 'server-only';
import { prisma } from '@nexushub/db';
import { reconcileOverdueRouting, type NewlyBlockedCard } from '@/features/projects/lib/reconcile';
import { createAgentNotice, type AgentNoticeInput } from '@/features/notifications/lib/notice-core';
import { inngestClient } from '../client';

/**
 * Scan horaire des cartes bloquées (Plan 3b Task 5) — MATÉRIALISE enfin le
 * « job Inngest cron toutes les heures : scan global des échéances dépassées
 * par workspace » de CLAUDE.md §6.3, jusqu'ici seulement approximé par le
 * reconcile-on-read (`reconcileBeforeRead`, appelé par les routes juste avant
 * de lire les cartes — voir le commentaire d'en-tête de `reconcile.ts`). Le
 * reconcile-on-read RESTE en place (complémentaire : il garantit un état
 * frais dès qu'un utilisateur ouvre une vue, même entre deux ticks du cron).
 *
 * IMPORTANT — cette fonction appelle `reconcileOverdueRouting` DIRECTEMENT,
 * PAS `reconcileBeforeRead` : `reconcileBeforeRead` applique
 * `shouldRunReconcile` (throttle 60 s **par process**, `reconcile-throttle.ts`)
 * pour amortir les navigations rapprochées d'un même utilisateur sur le
 * read-path. Ce throttle n'a aucun sens pour un cron qui tourne une fois par
 * heure de toute façon — pire, en environnement serverless multi-instance il
 * pourrait faire sauter un tick sur un process qui viendrait de servir une
 * requête. Le scan horaire doit reconcilier À CHAQUE tick, sans throttle.
 *
 * `reconcileOverdueRouting` (extension iso de Task 5, `reconcile.ts`) renvoie
 * désormais aussi `newlyBlocked` : les cartes que CE run a déplacées vers
 * Bloqué (pas celles déjà bloquées avant) — c'est cette liste qui déclenche
 * les notices, jamais un recomptage des cartes déjà en Bloqué.
 *
 * PINNED (voir `blocked-cards-scan-imports.test.ts`) : ce module (et
 * `functions/index.ts`) ne doit importer NI `@nexushub/agent` NI
 * provider/registry — aucun tour d'agent n'a lieu ici (même rationale que
 * `morning-briefing.ts`).
 *
 * PATTERN — `runBlockedCardsScan` extraite en fonction pure : même rationale
 * que `morning-briefing.ts` (aucun harnais de test Inngest installé dans ce
 * repo). `blockedCardsScan` (l'export Inngest) n'est qu'un fil électrique.
 */

/** Prisma leaf — aucune PII (uuids seulement). */
export async function listWorkspaceIds(): Promise<string[]> {
  const rows = await prisma.workspace.findMany({ select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * Prisma leaf — membres d'un projet (uuids seulement). Un projet sans membre
 * renvoie `[]` : c'est un no-op documenté (aucune notice envoyée), PAS une
 * erreur — voir `runBlockedCardsScan`.
 */
export async function listProjectMemberUserIds(projectId: string): Promise<string[]> {
  const rows = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

export interface BlockedCardsScanDeps {
  readonly listWorkspaceIds: () => Promise<readonly string[]>;
  /**
   * L'appel DIRECT à `reconcileOverdueRouting` (pas `reconcileBeforeRead`) —
   * voir le commentaire d'en-tête du fichier pour pourquoi le throttle du
   * read-path est bypassé ici.
   */
  readonly reconcile: (
    workspaceId: string,
    options: { readonly now?: Date },
  ) => Promise<{ readonly newlyBlocked: readonly NewlyBlockedCard[] }>;
  readonly listProjectMemberUserIds: (projectId: string) => Promise<readonly string[]>;
  readonly createNotice: (input: AgentNoticeInput) => Promise<{ created: boolean }>;
  /** `step.run` en prod ; un fake synchrone/async dans les tests. */
  readonly runStep: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
  readonly now: () => Date;
}

export interface BlockedCardsScanResult {
  readonly workspaces: number;
  readonly newlyBlocked: number;
  readonly notices: number;
}

function blockedCardMessage(card: NewlyBlockedCard): AgentNoticeInput['message'] {
  return `« ${card.title} » est passée en Bloqué (échéance dépassée).`;
}

function blockedCardDiscuss(card: NewlyBlockedCard): string {
  // ID + verbes SEULEMENT (contrat anti-injection de `notice-core.ts` — le
  // titre, potentiellement écrit par un tiers via l'app, ne doit JAMAIS
  // atterrir dans `discuss`, qui est réinjecté comme message utilisateur
  // dans le chat de l'assistant).
  return `Parlons de la carte ${card.cardId} passée en Bloqué`;
}

/**
 * Cœur pur de la fonction — voir le commentaire d'en-tête du fichier pour le
 * choix d'architecture. Isolation : une erreur pour UN workspace (reconcile
 * ou lookup des membres d'un projet) ne doit interrompre ni les autres
 * projets/cartes de ce workspace ni les workspaces suivants — d'où le
 * try/catch autour de chaque `runStep` par workspace (contrairement à
 * `morning-briefing.ts` où l'isolation est par MEMBRE, ici tout ce qui
 * concerne un workspace vit dans le même step : reconcile + notices).
 */
export async function runBlockedCardsScan(
  deps: BlockedCardsScanDeps,
): Promise<BlockedCardsScanResult> {
  const workspaceIds = await deps.listWorkspaceIds();
  let newlyBlockedTotal = 0;
  let notices = 0;

  for (const workspaceId of workspaceIds) {
    try {
      const { newlyBlocked, notices: workspaceNotices } = await deps.runStep(
        `scan-${workspaceId}`,
        async () => {
          const { newlyBlocked: cards } = await deps.reconcile(workspaceId, { now: deps.now() });
          let created = 0;
          for (const card of cards) {
            const memberUserIds = await deps.listProjectMemberUserIds(card.projectId);
            for (const userId of memberUserIds) {
              const outcome = await deps.createNotice({
                workspaceId,
                userId,
                kind: 'agent_card_blocked',
                message: blockedCardMessage(card),
                data: { ref: card.cardId, discuss: blockedCardDiscuss(card) },
              });
              if (outcome.created) created += 1;
            }
          }
          return { newlyBlocked: cards.length, notices: created };
        },
      );
      newlyBlockedTotal += newlyBlocked;
      notices += workspaceNotices;
    } catch {
      // Isolation (Task 5) : aucun détail loggé ici au-delà du compte final
      // — CLAUDE.md §4.7 interdit la PII, et une stack trace par échec
      // pourrait exposer des paramètres de requête.
    }
  }

  return { workspaces: workspaceIds.length, newlyBlocked: newlyBlockedTotal, notices };
}

export const blockedCardsScan = inngestClient.createFunction(
  { id: 'blocked-cards-scan', triggers: [{ cron: '0 * * * *' }] },
  async ({ step }) => {
    const result = await runBlockedCardsScan({
      listWorkspaceIds,
      reconcile: reconcileOverdueRouting,
      listProjectMemberUserIds,
      createNotice: createAgentNotice,
      // Voir le commentaire équivalent dans `morning-briefing.ts` pour le
      // cast : `step.run`'s return type est `Promise<Jsonify<Awaited<T>>>`,
      // structurellement identique ici (shape `{newlyBlocked, notices}`
      // faite de nombres) mais TS ne le prouve pas à travers un générique.
      runStep: (stepId, fn) => step.run(stepId, fn) as ReturnType<typeof fn>,
      now: () => new Date(),
    });
    // Comptes seulement — jamais de titre de carte ni d'identité
    // (CLAUDE.md §4.7). `console.warn` : seule méthode console autorisée par
    // le lint du repo avec `.error`.
    console.warn('[inngest] blocked-cards-scan', result);
    return result;
  },
);
