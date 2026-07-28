import 'server-only';
import type { InngestFunction } from 'inngest';
import { morningBriefing } from './morning-briefing';
import { blockedCardsScan } from './blocked-cards-scan';

/**
 * Registre des fonctions Inngest servies par `app/api/inngest/route.ts`.
 *
 * `morningBriefing` (Task 4) et `blockedCardsScan` (Task 5) ajoutées ; le
 * dernier cron (mails importants) arrive à la Task 6, dans son propre
 * fichier sous `lib/inngest/functions/`, puis poussé dans ce tableau.
 *
 * PINNED (Task 4/5) : ces fonctions ne doivent importer AUCUN provider/registry
 * de `@nexushub/agent` — les crons ne font aucun appel Anthropic (zéro
 * token, voir Architecture du plan 3b). Le test d'import de ce module fait
 * partie de la garde (`morning-briefing-imports.test.ts`,
 * `blocked-cards-scan-imports.test.ts`).
 */
export const functions: InngestFunction.Any[] = [morningBriefing, blockedCardsScan];
