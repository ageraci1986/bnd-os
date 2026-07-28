import 'server-only';
import { prisma } from '@nexushub/db';
import type { Role } from '@nexushub/domain';
import { briefSentence } from '@/lib/assistant/brief-sentence';
import {
  loadTodayOverview,
  type OverviewAuthContext,
  type TodayOverview,
} from '@/lib/assistant/overview-core';
import { createAgentNotice, type AgentNoticeInput } from '@/features/notifications/lib/notice-core';
import { inngestClient } from '../client';

/**
 * Briefing matinal (Plan 3b Task 4) — pousse la même phrase digérée que
 * l'accueil `/assistant` (`briefSentence`, factorisée depuis `DigestedBrief`)
 * en notice `agent_briefing`, chaque jour ouvré (lun-ven, 07:30
 * Europe/Brussels), sans AUCUN appel Anthropic (zéro token — voir "Écarts
 * spec assumés" du plan). La
 * conversation n'arrive que si l'utilisateur clique « En discuter » dans la
 * pile de notices (Task 7) — la notice elle-même est 100% déterministe.
 *
 * PINNED (voir `morning-briefing-imports.test.ts`) : ce module (et
 * `functions/index.ts`) ne doit importer NI `@nexushub/agent` NI
 * provider/registry — la garde `autoDeny` de la spec §8 n'a pas de sens ici
 * puisqu'aucun tour d'agent n'a lieu.
 *
 * PATTERN — pourquoi `runMorningBriefing` est extraite en fonction pure :
 * aucun harnais de test Inngest (`@inngest/test` ou équivalent) n'est
 * installé dans ce repo (vérifié : le SDK `inngest@4.13.0` n'exporte pas de
 * sous-chemin `./test`, et l'installer serait une dépendance supplémentaire
 * hors scope de cette tâche). Plutôt que de driver l'exécution durable réelle
 * dans les tests, la logique (filtrage opt-in, tout-à-zéro, isolation des
 * échecs par step) vit dans `runMorningBriefing(deps)` — testée directement
 * avec des fakes. `morningBriefing` (l'export Inngest) n'est plus qu'un fil
 * électrique : deps réelles (Prisma + `step.run`) branchées dessus. Le test
 * dédié à `morningBriefing` se limite donc à pinner le câblage (id, cron)
 * plutôt qu'à rejouer l'exécution.
 */

export interface BriefingMember {
  readonly userId: string;
  readonly role: Role;
}

/** Prisma leaf — aucune PII (uuids seulement). */
export async function listWorkspaceIds(): Promise<string[]> {
  const rows = await prisma.workspace.findMany({ select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * Prisma leaf — membres ayant opté au briefing matinal pour un workspace.
 * Ne filtre QUE sur `assistantBriefingOptIn` : le kill switch global
 * (`assistantProactivity`) est re-vérifié par `createAgentNotice` lui-même
 * (contrat documenté dans `notice-core.ts`), pas dupliqué ici.
 */
export async function listBriefingOptedInMembers(workspaceId: string): Promise<BriefingMember[]> {
  return prisma.membership.findMany({
    where: { workspaceId, assistantBriefingOptIn: true },
    select: { userId: true, role: true },
  });
}

/**
 * `YYYY-MM-DD` en Europe/Brussels — DOIT utiliser le même fuseau que le cron
 * (`TZ=Europe/Brussels 30 7 * * 1-5`), pas l'heure serveur/UTC : sinon la
 * référence de dédup (`briefing-<date>`) pourrait sauter ou dupliquer un jour
 * autour de minuit UTC.
 */
export function brusselsDateStamp(now: Date): string {
  // Locale `en-CA` formate en `YYYY-MM-DD` nativement — évite un montage
  // manuel de la chaîne à partir de `formatToParts`.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function isAllZero(overview: TodayOverview): boolean {
  return (
    overview.blockedCards === 0 &&
    overview.dueTodayCards === 0 &&
    overview.unreadMails === 0 &&
    overview.unreadNotifications === 0
  );
}

export interface MorningBriefingDeps {
  readonly listWorkspaceIds: () => Promise<readonly string[]>;
  readonly listBriefingOptedInMembers: (workspaceId: string) => Promise<readonly BriefingMember[]>;
  readonly loadOverview: (ctx: OverviewAuthContext) => Promise<TodayOverview>;
  readonly createNotice: (input: AgentNoticeInput) => Promise<{ created: boolean }>;
  /** `step.run` en prod ; un fake synchrone/async dans les tests. */
  readonly runStep: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
  readonly now: () => Date;
}

export interface MorningBriefingResult {
  readonly workspaces: number;
  readonly notices: number;
}

/**
 * Cœur pur de la fonction — voir le commentaire d'en-tête du fichier pour le
 * choix d'architecture. Isolation : une erreur `loadOverview`/`createNotice`
 * pour un membre ne doit interrompre ni les autres membres du workspace ni
 * les workspaces suivants.
 */
export async function runMorningBriefing(
  deps: MorningBriefingDeps,
): Promise<MorningBriefingResult> {
  const ref = `briefing-${brusselsDateStamp(deps.now())}`;
  const workspaceIds = await deps.listWorkspaceIds();
  let notices = 0;

  for (const workspaceId of workspaceIds) {
    const members = await deps.listBriefingOptedInMembers(workspaceId);
    for (const member of members) {
      try {
        const { created } = await deps.runStep(`briefing-${member.userId}`, async () => {
          const overview = await deps.loadOverview({
            workspaceId,
            userId: member.userId,
            role: member.role,
            isSuperAdmin: false,
          });
          if (isAllZero(overview)) return { created: false };
          const input: AgentNoticeInput = {
            workspaceId,
            userId: member.userId,
            kind: 'agent_briefing',
            message: briefSentence(overview),
            data: { ref, discuss: 'Détaille mon briefing du jour' },
          };
          return deps.createNotice(input);
        });
        if (created) notices += 1;
      } catch {
        // Isolation (Task 4) : aucun détail loggé ici au-delà du compte final
        // — CLAUDE.md §4.7 interdit la PII, et une stack trace par échec
        // pourrait exposer des paramètres de requête.
      }
    }
  }

  return { workspaces: workspaceIds.length, notices };
}

export const morningBriefing = inngestClient.createFunction(
  { id: 'morning-briefing', triggers: [{ cron: 'TZ=Europe/Brussels 30 7 * * 1-5' }] },
  async ({ step }) => {
    const result = await runMorningBriefing({
      listWorkspaceIds,
      listBriefingOptedInMembers,
      loadOverview: loadTodayOverview,
      createNotice: createAgentNotice,
      // `step.run`'s return type is `Promise<Jsonify<Awaited<T>>>` (Inngest
      // serializes step output to/from JSON across retries) — structurally
      // identical to `Promise<T>` for the plain `{ created: boolean }`
      // shape this function actually returns, but TS can't fold that
      // through a generic `T` at this call site. Cast documented here
      // rather than widening `MorningBriefingDeps['runStep']` itself, which
      // would leak an Inngest-specific type into the pure core.
      runStep: (stepId, fn) => step.run(stepId, fn) as ReturnType<typeof fn>,
      now: () => new Date(),
    });
    // Comptes seulement — jamais de titre de carte, d'objet de mail ni
    // d'identité (CLAUDE.md §4.7). `console.warn` (pas `.log`) : seule
    // méthode console autorisée par le lint du repo avec `.error`.
    console.warn('[inngest] morning-briefing', result);
    return result;
  },
);
