import 'server-only';
import type { InngestFunction } from 'inngest';
import { morningBriefing } from './morning-briefing';

/**
 * Registre des fonctions Inngest servies par `app/api/inngest/route.ts`.
 *
 * `morningBriefing` (Task 4) ajouté ; les 2 crons restants (scan horaire des
 * cartes bloquées, mails importants) arrivent aux Tasks 5-6, chacun dans son
 * propre fichier sous `lib/inngest/functions/`, puis poussés dans ce tableau.
 *
 * PINNED (Task 4) : ces fonctions ne doivent importer AUCUN provider/registry
 * de `@nexushub/agent` — les crons ne font aucun appel Anthropic (zéro
 * token, voir Architecture du plan 3b). Le test d'import de ce module fait
 * partie de la garde (`morning-briefing-imports.test.ts`).
 */
export const functions: InngestFunction.Any[] = [morningBriefing];
