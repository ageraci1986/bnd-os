import 'server-only';
import type { InngestFunction } from 'inngest';
import { morningBriefing } from './morning-briefing';
import { blockedCardsScan } from './blocked-cards-scan';
import { importantMails } from './important-mails';

/**
 * Registre des fonctions Inngest servies par `app/api/inngest/route.ts`.
 *
 * `morningBriefing` (Task 4), `blockedCardsScan` (Task 5) et `importantMails`
 * (Task 6) — les trois crons de la spec Plan 3b sont désormais enregistrés.
 *
 * PINNED (Task 4/5/6) : ces fonctions ne doivent importer AUCUN provider/registry
 * de `@nexushub/agent` — les crons ne font aucun appel Anthropic (zéro
 * token, voir Architecture du plan 3b). Le test d'import de ce module fait
 * partie de la garde (`morning-briefing-imports.test.ts`,
 * `blocked-cards-scan-imports.test.ts`, `important-mails-imports.test.ts`).
 */
export const functions: InngestFunction.Any[] = [morningBriefing, blockedCardsScan, importantMails];
