import { serve } from 'inngest/next';
import { inngestClient } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

/**
 * Endpoint Inngest (App Router — GET/POST/PUT requis, cf. doc Inngest
 * "Serving Inngest Functions with Next.js").
 *
 * - GET  : introspection (le dashboard/dev server lit la config des fonctions).
 * - POST : invocation d'une fonction (step run).
 * - PUT  : sync — enregistre cette app auprès d'Inngest (dashboard en prod,
 *          dev server en local).
 *
 * SECURITY : en prod, chaque requête entrante est vérifiée par le SDK via
 * `INNGEST_SIGNING_KEY` (lu depuis `process.env`, jamais manipulé ici) —
 * cf. CLAUDE.md §4.1/§4.2 (aucun secret en clair, aucune vérification
 * maison). En dev (`INNGEST_DEV=1`), la vérification de signature est
 * désactivée par le SDK.
 *
 * Flux local complet :
 *   1. `.env.local` : ajouter `INNGEST_DEV=1` (mode, pas un secret — laisse
 *      `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` vides, cf. lib/inngest/client.ts).
 *   2. Terminal A : `npx inngest-cli dev` — lance le dev server sur
 *      http://localhost:8288 (UI + orchestration locale, aucune clé requise).
 *   3. Terminal B : `pnpm --filter @nexushub/web dev` — sert cette route sur
 *      http://localhost:3000/api/inngest.
 *   4. Le dev server découvre/sync automatiquement l'app en sondant les
 *      ports courants (ou ajouter l'URL manuellement dans son UI si besoin).
 *   5. Les fonctions crons (Tasks 4-6) apparaissent alors dans l'UI du dev
 *      server, déclenchables manuellement pour tester sans attendre le cron.
 *
 * Les fonctions servies vivent dans `lib/inngest/functions/` — ce tableau
 * est vide au socle (Task 2) et s'étend aux Tasks 4-6.
 */
export const { GET, POST, PUT } = serve({
  client: inngestClient,
  functions,
});
