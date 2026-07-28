import 'server-only';
import type { InngestFunction } from 'inngest';

/**
 * Registre des fonctions Inngest servies par `app/api/inngest/route.ts`.
 *
 * Vide pour l'instant (Plan 3b Task 2 — socle). Les 3 crons de proactivité
 * (briefing matinal, scan horaire des cartes bloquées, mails importants)
 * sont ajoutés aux Tasks 4-6, chacun dans son propre fichier sous
 * `lib/inngest/functions/`, puis poussé dans ce tableau.
 *
 * PINNED (Task 4) : ces fonctions ne doivent importer AUCUN provider/registry
 * de `@nexushub/agent` — les crons ne font aucun appel Anthropic (zéro
 * token, voir Architecture du plan 3b). Le test d'import de ce module fait
 * partie de la garde.
 */
export const functions: InngestFunction.Any[] = [];
