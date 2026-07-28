import 'server-only';
import { prisma } from '@nexushub/db';
import { reconcileOverdueRouting, type NewlyBlockedCard } from '@/features/projects/lib/reconcile';
import { notifyNewlyBlocked } from '@/features/notifications/lib/blocked-card-notices';
import { inngestClient } from '../client';

/**
 * Scan horaire des cartes bloquées (Plan 3b Task 5) — MATÉRIALISE enfin le
 * « job Inngest cron toutes les heures : scan global des échéances dépassées
 * par workspace » de CLAUDE.md §6.3, jusqu'ici seulement approximé par le
 * reconcile-on-read (`reconcileBeforeRead`, appelé par les routes juste avant
 * de lire les cartes — voir le commentaire d'en-tête de `reconcile.ts`). Le
 * reconcile-on-read RESTE en place (complémentaire : il garantit un état
 * frais dès qu'un utilisateur ouvre une vue, même entre deux ticks du cron)
 * et crée LUI AUSSI les notices via le helper partagé `notifyNewlyBlocked`
 * (revue groupée 4-6, fix 1) — la dédup du notice core empêche tout doublon
 * entre les deux chemins.
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
 * SÉMANTIQUE DE RETRY (revue groupée 4-6, fix 2) — DEUX steps par workspace :
 *
 *   1. `scan-<ws>` appelle `reconcileOverdueRouting` et retourne la liste
 *      SÉRIALISABLE `newlyBlocked` (les cartes que CE run a déplacées vers
 *      Bloqué — pas celles déjà bloquées avant). Inngest MÉMOÏSE le résultat
 *      de chaque step réussi : au retry de la fonction, ce step n'est PAS
 *      rejoué, la liste survit.
 *   2. `notify-<ws>` crée les notices depuis cette liste mémoïsée.
 *
 * Si les deux vivaient dans le MÊME step, un échec partiel de notify
 * rejouerait le step entier : le second reconcile ne retournerait plus les
 * cartes (déjà en Bloqué) → notices perdues DÉFINITIVEMENT. Avec deux steps,
 * un échec de notify est rejoué par Inngest avec la liste du scan intacte.
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
  /** `notifyNewlyBlocked` (helper partagé avec le read-path) en prod. */
  readonly notify: (
    workspaceId: string,
    newlyBlocked: readonly NewlyBlockedCard[],
  ) => Promise<{ readonly notices: number }>;
  /** `step.run` en prod ; un fake synchrone/async dans les tests. */
  readonly runStep: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
  readonly now: () => Date;
}

export interface BlockedCardsScanResult {
  readonly workspaces: number;
  readonly newlyBlocked: number;
  readonly notices: number;
}

/**
 * Cœur pur de la fonction — voir le commentaire d'en-tête du fichier pour le
 * choix d'architecture (deux steps scan/notify par workspace, retry-safe).
 * Isolation : une erreur pour UN workspace (scan ou notify) ne doit pas
 * interrompre les workspaces suivants — d'où le try/catch autour de chaque
 * step de chaque workspace.
 */
export async function runBlockedCardsScan(
  deps: BlockedCardsScanDeps,
): Promise<BlockedCardsScanResult> {
  const workspaceIds = await deps.listWorkspaceIds();
  let newlyBlockedTotal = 0;
  let notices = 0;

  for (const workspaceId of workspaceIds) {
    // STEP 1 — scan : reconcile + retour de la liste sérialisable (mémoïsée
    // par Inngest au retry — voir l'en-tête du fichier).
    let newlyBlocked: readonly NewlyBlockedCard[];
    try {
      newlyBlocked = await deps.runStep(`scan-${workspaceId}`, async () => {
        const result = await deps.reconcile(workspaceId, { now: deps.now() });
        return result.newlyBlocked;
      });
      newlyBlockedTotal += newlyBlocked.length;
    } catch {
      // Isolation (Task 5) : aucun détail loggé ici au-delà du compte final
      // — CLAUDE.md §4.7 interdit la PII, et une stack trace par échec
      // pourrait exposer des paramètres de requête.
      continue;
    }
    if (newlyBlocked.length === 0) continue;

    // STEP 2 — notify : notices depuis la liste retournée par le step scan
    // (jamais un re-appel de reconcile).
    try {
      const { notices: created } = await deps.runStep(`notify-${workspaceId}`, async () =>
        deps.notify(workspaceId, newlyBlocked),
      );
      notices += created;
    } catch {
      // Même politique d'isolation — le workspace suivant continue.
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
      notify: notifyNewlyBlocked,
      // Voir le commentaire équivalent dans `morning-briefing.ts` pour le
      // cast : `step.run`'s return type est `Promise<Jsonify<Awaited<T>>>`,
      // structurellement identique ici (liste de {cardId,title,projectId} et
      // shape {notices}) mais TS ne le prouve pas à travers un générique.
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
