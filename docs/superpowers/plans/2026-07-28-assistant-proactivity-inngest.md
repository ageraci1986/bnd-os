# Plan 3b — Assistant : proactivité Inngest (briefing matinal, notices, préférences)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'assistant devient proactif : briefing matinal poussé en notice, notice quand une carte passe en Bloqué (via un VRAI scan horaire Inngest qui matérialise enfin CLAUDE.md §6.3), notice « mail important » (contact client connu, non lu > 4 h) — le tout affiché en pile sur `/assistant` (« En discuter » préremplit le chat, « Ignorer » marque lu), avec point animé dans la sidebar et préférences par type + kill switch dans Settings.

**Architecture:** Inngest (nouvelle dep — Context7 obligatoire) : client + route `/api/inngest` + 3 fonctions cron. Les notices = table `notification` existante (3 nouvelles valeurs de kind + canal `in_app`), créées par un core unique `createAgentNotice` (dédup + respect des préférences/kill switch). AUCUN appel Anthropic dans les crons : le briefing réutilise `loadTodayOverview` (déterministe, zéro token) — la conversation arrive quand l'utilisateur clique « En discuter » (déviation spec §4 « compose via runTurn », justifiée : coût/latence/fiabilité ; la valeur conversationnelle est dans le clic, pas dans la notice). Préférences : colonnes sur `Membership` (kill switch + opt-in briefing) + `NotificationPreference` (par type). UI : pile de notices server-loaded sur `/assistant`, boutons branchés sur le canal `WidgetActions.sendMessage` existant (Plan 4).

**Tech Stack:** Inngest (version via Context7), Prisma (1 migration), React. Web Push HORS SCOPE (aspirationnel — dette).

**Spec :** `docs/superpowers/specs/2026-07-27-assistant-agent-design.md` §4 (l.111-124), §2 décisions 4/6, §6 l.142+153-154, §8 l.190-191.

**Branche :** `feat/assistant-proactivity-inngest` (depuis main post-#19). Clés Inngest : posées dans Vercel par Angelo (2026-07-28). En local, le dev server Inngest (`npx inngest-cli dev`) tourne SANS clés.

**Écarts spec assumés (à reporter en PR) :**

- Briefing composé par `loadTodayOverview` (zéro token), PAS par `runTurn` — voir Architecture. L'`autoDeny` du confirmer devient donc sans objet dans les crons (aucun tour d'agent) ; le test spec §8 « autoDeny vérifié » est remplacé par « aucun provider/registry importé par les fonctions Inngest » (pinné).
- Cron briefing à **07:30 Europe/Brussels fixe** (la timezone par utilisateur n'existe pas — Settings était un placeholder ; per-user TZ = suivi).
- « Quiet hours = préférences existantes » (spec) : les préférences n'existaient PAS — cette itération crée les toggles par type + kill switch ; les plages horaires silencieuses = suivi.
- « Cloche standard » : aucun centre de notifications n'existe dans l'app — la pile `/assistant` + le point sidebar + le KPI Notices (déjà branché sur le count) sont la surface V1 ; cloche globale = suivi.
- Spec §10 corrigée au passage : Inngest n'était PAS « déjà présent ».
- Web push / service worker / VAPID : hors scope (modèles en schéma inutilisés — dette listée).

**Conventions transverses :** identiques aux plans précédents (TDD, cores purs testés, workspace_id partout, messages user-safe, pas de PII dans les logs — les fonctions Inngest loggent des comptes/ids, JAMAIS de titres de cartes ni d'objets de mails).

---

### Task 1: Migration — kinds agent, canal in_app, préférences Membership

**Files:** `packages/db/prisma/schema.prisma` + `packages/db/prisma/migrations/20260728210000_assistant_proactivity/migration.sql`

- Enum `NotificationKind` : + `agent_briefing`, `agent_card_blocked`, `agent_mail_important`.
- Enum `NotificationChannel` : + `in_app`.
- Modèle `Membership` : + `assistantProactivity Boolean @default(true) @map("assistant_proactivity")` (kill switch) et `assistantBriefingOptIn Boolean @default(false) @map("assistant_briefing_opt_in")` (spec : briefing opt-in).
- Table `notification` : index `@@index([userId, kind, readAt])` (dédup + pile).

```sql
-- Plan 3b: proactivité assistant — notices in-app, préférences par membre.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'agent_briefing';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'agent_card_blocked';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'agent_mail_important';
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'in_app';

ALTER TABLE "memberships"
  ADD COLUMN "assistant_proactivity" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "assistant_briefing_opt_in" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "notifications_user_id_kind_read_at_idx"
  ON "notifications" ("user_id", "kind", "read_at");
```

(Adapter les noms de tables/index aux conventions réelles du schéma — vérifier `@@map` de Membership/Notification.) `prisma generate` + typecheck verts. Contrôleur : migration appliquée sur staging AVANT merge.

Commit : `feat(db): notices agent + préférences proactivité (plan 3b)`

---

### Task 2: Inngest — install (Context7), client, route

**Files:** `apps/web/package.json`, `apps/web/lib/inngest/client.ts`, `apps/web/app/api/inngest/route.ts` (+ test), `.env.example` (rien à ajouter — clés déjà listées)

- **Context7 OBLIGATOIRE avant install** : version stable d'`inngest`, compat Next 15 App Router (`serve` de `inngest/next`), breaking changes. Noter version + justification dans rapport et commit body.
- `client.ts` : `new Inngest({ id: 'nexushub' })` — l'event key est lue par le SDK via `INNGEST_EVENT_KEY` (documente : absente en dev → mode dev server local).
- `route.ts` : `serve({ client, functions: [...] })` — exporte GET/POST/PUT. La signature est vérifiée par le SDK via `INNGEST_SIGNING_KEY` (prod). Les fonctions arrivent aux Tasks 4-6 — la route démarre avec un tableau vide puis s'étend.
- Test route : le handler existe et rejette une requête non signée en mode prod simulé (suivre la doc du SDK pour le testing — sinon test minimal d'export). Documenter le flux local (`npx inngest-cli dev` + `pnpm --filter @nexushub/web dev`).

Commit : `feat(inngest): client + route /api/inngest (version Context7)`

---

### Task 3: Core notices — `createAgentNotice` + `markNotificationRead`

**Files:** `apps/web/features/notifications/lib/notice-core.ts` (+ test), `apps/web/features/notifications/actions/mark-read.ts` (+ test)

```ts
export type AgentNoticeKind = 'agent_briefing' | 'agent_card_blocked' | 'agent_mail_important';

export interface AgentNoticeInput {
  workspaceId: string;
  userId: string;
  kind: AgentNoticeKind;
  /** Texte montrable de la notice (une phrase, sans PII au-delà de ce que l'utilisateur voit déjà dans l'app). */
  message: string;
  /** Référence structurée (cardId/mailId/date du briefing) + suggestion de message « En discuter ». */
  data: { ref?: string; discuss: string };
}

export async function createAgentNotice(input: AgentNoticeInput): Promise<{ created: boolean }>;
```

Comportement : (1) charge `Membership` (workspaceId+userId) → `assistantProactivity === false` → `{created:false}` ; briefing ET `assistantBriefingOptIn === false` → `{created:false}` ; (2) `NotificationPreference` (userId, kind, channel 'in_app') `enabled === false` → `{created:false}` ; (3) **dédup** : notification NON LUE existante même (userId, kind, `data.ref`) → `{created:false}` (le briefing dédupe par ref = date du jour) ; (4) create `{workspaceId, userId, kind, channel:'in_app', data}` — le `message` va DANS data (`data.message`). Tests : chaque garde, dédup (ref identique non-lu → skip ; lu → re-crée), aucune PII exigée par le core (contrat commenté).

`markNotificationRead({notificationId})` : Server Action — `updateMany where {id, workspaceId, userId} data {readAt: now}` (première écriture de readAt du repo). CSRF selon la convention des actions JSON du repo. Tests : scoping pinné, idempotent.

Commit : `feat(notifications): core notices agent (préférences + dédup) + markRead`

---

### Task 4: Fonction Inngest — briefing matinal

**Files:** `apps/web/lib/inngest/functions/morning-briefing.ts` (+ test), route étendue

- Cron `TZ=Europe/Brussels 30 7 * * 1-5` (jours ouvrés — décision : le briefing week-end n'a pas de valeur agence ; documenter).
- Pour chaque workspace, pour chaque membre avec `assistantBriefingOptIn=true` (et proactivity=true — le core re-vérifie) : `loadTodayOverview(ctxLike)` — ATTENTION : le core overview prend un `AuthContext` ; construire un ctx serveur `{workspaceId, userId, role}` depuis Membership (PAS de session — vérifier que loadTodayOverview/loadUserScope n'exigent que ces champs ; sinon adapter le core pour accepter un contexte minimal, iso pour l'appelant existant).
- Si overview tout-à-zéro → pas de notice. Sinon : `message` = la MÊME phrase digérée que l'accueil (FACTORISER la fonction de phrase de `DigestedBrief` dans un module partagé `apps/web/lib/assistant/brief-sentence.ts` — le composant l'importe, la fonction Inngest aussi ; tests de la phrase déplacés/étendus), `data.ref = 'briefing-YYYY-MM-DD'`, `data.discuss = 'Détaille mon briefing du jour'`.
- `step.run` par utilisateur (isolation des échecs). Logs : comptes seulement.
- Tests : fonction exécutée avec prisma mocké — opt-in filtré, tout-à-zéro sauté, notice créée via createAgentNotice (spy), AUCUN import de provider/registry (test d'import pinné — remplace l'exigence autoDeny de la spec).

Commit : `feat(inngest): briefing matinal en notice (zéro token, opt-in)`

---

### Task 5: Fonction Inngest — scan horaire cartes bloquées

**Files:** `apps/web/lib/inngest/functions/blocked-cards-scan.ts` (+ test), route étendue

- Cron horaire (`0 * * * *`). Par workspace : appelle `reconcileOverdueRouting` (RÉUTILISE `apps/web/features/projects/lib/reconcile.ts` — vérifier sa signature : il faut probablement l'adapter pour retourner LA LISTE des cartes nouvellement bloquées `{cardId, title, projectId}` en plus de son effet — extension iso : l'appel existant reconcileBeforeRead ignore le retour).
- Pour chaque carte nouvellement bloquée : notice `agent_card_blocked` aux MEMBRES DU PROJET (`ProjectMember` → userIds ; fallback si projet sans membres : personne — documenter), `message` = `« <titre carte> » est passée en Bloqué (échéance dépassée)`, `data.ref = cardId`, `data.discuss = 'Parlons de la carte <cardId> passée en Bloqué'` (id, pas le titre — cohérence anti-injection Plan 5c ; le titre est OK dans message car affiché à l'utilisateur qui le voit déjà dans l'app).
- Ce cron MATÉRIALISE le « job Inngest cron toutes les heures » de CLAUDE.md §6.3 (jusqu'ici reconcile-on-read seulement) — le reconcile-on-read RESTE en place (complémentaire).
- Tests : reconcile appelé par workspace ; notices aux membres du projet seulement ; dédup (carte déjà notifiée non-lue → skip via core) ; throttle réutilisé ou bypassé proprement (le throttle 60 s de reconcile-throttle est par process — vérifier qu'il n'avale pas le cron : l'appel direct de reconcileOverdueRouting sans throttle est le bon chemin).

Commit : `feat(inngest): scan horaire des échéances → notices cartes bloquées`

---

### Task 6: Fonction Inngest — mails importants

**Files:** `apps/web/lib/inngest/functions/important-mails.ts` (+ test), route étendue

- Cron toutes les 30 min. Par workspace : mails `{isRead:false, deletedAt:null, archivedAt:null, receivedAt < now-4h, folder:'inbox'}` dont `fromEmail` matche un `Contact.email` du workspace (join Citext — requête Prisma via `in` sur les emails contacts, borné aux 500 derniers mails). Notice au PROPRIÉTAIRE de la boîte (`integration.ownerUserId` — un mail sans owner → skip).
- `message` = `Mail de <fromName ?? fromEmail> (<nom client>) non lu depuis plus de 4 h`, `data.ref = mailId`, `data.discuss = 'Parlons du mail <mailId> — propose-moi une réponse'`.
- Dédup par mailId via le core (une notice non-lue par mail ; mail lu entre-temps → la notice reste mais le clic mène au mail — acceptable, dette).
- Tests : heuristique (contact connu match, inconnu non), fenêtre 4 h, owner-only, borne 500, dédup.

Commit : `feat(inngest): notices mails importants (contact connu, non lu > 4 h)`

---

### Task 7: UI — pile de notices `/assistant`, « En discuter », point sidebar

**Files:** `apps/web/features/assistant/components/notice-stack.tsx` (+ test), `apps/web/app/(app)/assistant/page.tsx`, `apps/web/features/assistant/components/assistant-chat.tsx` (léger), sidebar (`apps/web/features/shell/…` — trouver le composant nav)

- `page.tsx` : charge les notices non lues de l'utilisateur (`kind in (3 agent kinds)`, `readAt null`, orderBy createdAt desc, take 5) → prop `notices` à AssistantChat.
- `NoticeStack` (rendu entre les KPI et le fil, style `.ap-notice` de la maquette — bandeau dégradé léger, 🔔, message, boutons pill « En discuter » (grad) / « Ignorer » (ghost)) :
  - « En discuter » → `actions.sendMessage(notice.data.discuss)` + `markNotificationRead` (optimiste, la notice disparaît) ;
  - « Ignorer » → `markNotificationRead` (optimiste + rollback si échec).
  - HORS aria-live. Rendu via le canal WidgetActions existant (AssistantChat construit déjà `sendMessage`).
- **Point sidebar** : dans le composant nav du shell, l'entrée Assistant reçoit un point animé si count non-lu > 0 (count chargé dans le layout serveur — attention perf : count léger indexé ; classe `.dot` animée à porter de la maquette l.28 en `nx-*` si pas déjà fait).
- Le KPI « Notices » (déjà branché) reflète le count — cohérence gratuite.
- Tests : stack rendue avec notices, En discuter → sendMessage exact + markRead, Ignorer → markRead + rollback, vide → rien ; dot conditionnel.

Commit : `feat(assistant): pile de notices (En discuter/Ignorer) + point sidebar`

---

### Task 8: Settings — section Assistant (kill switch + toggles)

**Files:** `apps/web/app/(app)/settings/page.tsx` (remplace le ComingSoon par une vraie page minimale), `apps/web/features/settings/` (nouveau : `components/assistant-preferences.tsx`, `actions/update-assistant-preferences.ts` + tests)

- Section « Assistant » : toggle maître « Proactivité de l'assistant » (Membership.assistantProactivity), toggle « Briefing matinal (07:30, jours ouvrés) » (assistantBriefingOptIn, désactivé si maître off), 3 toggles par type (NotificationPreference kind×in_app, `enabled`, défaut true — upsert). Sauvegarde AUTOMATIQUE avec toast (décision ADR #10) via l'action, CSRF, workspace/user scopés.
- Le reste de la page Settings reste « à venir » (sections placeholder) — on ne construit QUE la section Assistant.
- Tests : action (upserts pinnés, scoping), composant (toggles → action, état désactivé).

Commit : `feat(settings): préférences proactivité assistant (kill switch + par type)`

---

### Task 9: Suites + docs + revue holistique → PR → sync Inngest

- `pnpm turbo run test typecheck lint` 17/17 ; couverture agent 100 % intacte.
- Spec §10 corrigée (Inngest n'était pas présent) ; progress.md + CLAUDE.md §11 (+ §6.3 : noter que le scan horaire est désormais réel).
- Revue holistique (superpowers:code-reviewer) : flux tracés (cron → core notice → pile → En discuter → chat prérempli ; kill switch coupe TOUT), aucun provider importé par les crons, PII (messages de notices : titres/expéditeurs = données que l'utilisateur voit déjà — OK ; logs = comptes seulement), migration staging appliquée.
- PR template FR ; dette : web push/VAPID, cloche globale, quiet hours, TZ par utilisateur, notice mail restante après lecture du mail.
- POST-MERGE (contrôleur + Angelo) : vérifier la sync de l'app dans le dashboard Inngest (le déploiement Vercel avec SIGNING_KEY expose `/api/inngest` ; sync via le dashboard « Sync app » avec l'URL prod) et tester un déclenchement manuel.

---

## Self-review

- Spec §4 : briefing (T4, déviation zéro-token documentée), cartes bloquées (T5 — crée AUSSI le vrai scan horaire §6.3), mails importants (T6), notices unifiées (T1+T3 — kind/data au lieu de type/payload : mappé sur le schéma réel), kill switch (T1+T8), « En discuter »/pile/point sidebar (T7). §8 : tests unitaires des 3 fonctions avec le remplacement d'autoDeny documenté. ✅
- Décisions encadrées laissées à l'implémenteur : adaptation du retour de reconcileOverdueRouting (extension iso), ctx minimal pour loadTodayOverview, composant nav exact du shell — chacune avec instruction de vérification.
- Types inter-tâches : createAgentNotice (T3) consommé T4/T5/T6 ; brief-sentence partagé (T4) consommé par DigestedBrief ; notices prop (T7) ; Membership flags (T1) consommés T3/T8.
