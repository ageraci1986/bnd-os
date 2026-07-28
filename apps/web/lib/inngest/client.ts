import 'server-only';
import { Inngest } from 'inngest';

/**
 * Client Inngest partagé (socle Plan 3b — proactivité assistant).
 *
 * `id` identifie l'app côté dashboard Inngest ; il n'y a qu'un seul client
 * dans ce repo. Aucune autre config n'est requise : le SDK lit
 * `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` lui-même depuis `process.env`
 * (jamais lues/loggées ici — voir CLAUDE.md §4.1). Elles sont déjà déclarées
 * dans `.env.example` et `apps/web/lib/env.ts`.
 *
 * SECURITY (Inngest SDK v4 — breaking change vs v3, cf. guide de migration
 * v3→v4) : le mode par défaut est désormais "cloud", plus "dev". Sans
 * `INNGEST_SIGNING_KEY` (prod) NI `INNGEST_DEV=1` (local), le client tente
 * le mode cloud et échoue. En développement local, définir `INNGEST_DEV=1`
 * dans `.env.local` (flag de mode, pas un secret — volontairement absent de
 * `.env.example` qui ne liste que les clés) ET lancer le dev server Inngest
 * (`npx inngest-cli dev`) — voir le commentaire d'en-tête de
 * `app/api/inngest/route.ts` pour le flux complet.
 */
export const inngestClient = new Inngest({ id: 'nexushub' });
