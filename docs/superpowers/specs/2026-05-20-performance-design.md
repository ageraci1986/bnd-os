# Performance — Design Spec (partie projet)

> **Date** : 2026-05-20
> **Branche** : `performance`
> **Scope** : supprimer la latence perçue des actions de la partie projet (création/ouverture/fermeture de carte, edit titre/champ/échéance, checklist, commentaires, avancement). Objectif : que **mes propres actions soient instantanées**. Pas de synchro temps-réel multi-utilisateur dans ce lot (chantier séparé ultérieur).

## Diagnostic (mesuré par lecture du code)

Chaque mutation de la partie projet paie, séquentiellement :

1. **`requireUser()` → `supabase.auth.getUser()` = appel RÉSEAU à Supabase Auth** pour valider le JWT, à chaque action **et** à chaque rendu de page (~100-300 ms). `cache()` ne déduplique qu'au sein d'un même rendu ; chaque server action re-paie l'appel.
2. **+ `prisma.user.findUnique`** (auth) + **`loadUserScope`** + le `findFirst` de l'action + l'`update` = 3-4 allers-retours DB (eu-west-1).
3. **`revalidatePath` / `router.refresh()`** : 24/25 actions appellent `revalidatePath` ; 9 composants appellent `router.refresh()`. → après chaque mutation, **toute la page projet est recalculée serveur** : re-`getUser()` réseau + `reconcileBeforeRead` (lectures **+ écritures**) + les **6 requêtes Prisma** du `Promise.all` de la page.
4. **`reconcileBeforeRead`** tourne à **chaque** rendu (projet/list/calendar/overview) et fait des **écritures**.

Conséquence : même une frappe de titre (pourtant déjà optimiste localement) déclenche en arrière-plan ~1 appel auth réseau + ~3 requêtes + un **recalcul complet de page** (auth réseau + reconcile + 6 requêtes). D'où la lourdeur globale, y compris en local.

Déjà optimistes côté client : titre (`CardTitleInput`, debounce 600 ms, pas de refresh) et description (`CardDescriptionInput`). Le problème principal est l'**overhead serveur par action** + les **refetch complets** déclenchés partout.

## Décisions actées (brainstorming 2026-05-20)

| #   | Sujet     | Choix                                                                                                                                  |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Périmètre | Mes actions instantanées (optimistic UI + suppression overhead). Pas de realtime multi-user.                                           |
| 2   | Auth      | **Hybride** : vérif JWT locale (zéro réseau) + check d'existence DB conservé + `getUser()` réseau gardé sur les actions destructrices. |

## Architecture des optimisations

### A. Auth hybride — vérification JWT locale

**Fichiers** : `apps/web/lib/auth/index.ts`, possiblement un nouvel util `apps/web/lib/auth/verify-jwt.ts`.

- `getAuthContext()` : remplacer `supabase.auth.getUser()` (réseau) par une **vérification locale de la signature** du JWT lu dans le cookie de session Supabase.
  - Mécanisme : tenter `supabase.auth.getClaims()` (vérifie en local via JWKS si le projet utilise des clés asymétriques, JWKS mis en cache). **Fallback / cas HS256** : vérifier avec `jose.jwtVerify` + `SUPABASE_JWT_SECRET` (déjà présent dans l'env). Le mécanisme exact (asymétrique vs HS256) est confirmé à l'implémentation en inspectant le token réel ; les deux sont locaux et sûrs.
  - On extrait `sub` (userId) + `email` des claims vérifiés.
  - On **conserve** `prisma.user.findUnique` (existence + rôle + workspace + isSuperAdmin). Un user supprimé → `null` → traité non-authentifié immédiatement.
  - Reste enveloppé dans `cache()`.
- Nouveau guard **`requireUserVerified()`** : fait un `getUser()` réseau (révocation immédiate). À utiliser dans les actions destructrices : `delete-workspace`, `change-member-role`, `delete-project`, `delete-client`, suppression d'intégration. (Identifier précisément ces actions à l'implémentation ; coût réseau acceptable car rares.)
- **Sécurité** : conforme CLAUDE.md §4.3.8 (« toujours vérifier la signature avec la clé Supabase »). Compromis assumé : fenêtre de révocation Supabase-Auth ≤ 1h (durée de vie du token) hors actions destructrices ; mitigée par le check d'existence DB et le `requireUserVerified` ciblé.

> **Note `getSession()` interdit** : on ne se contente PAS de décoder le cookie sans vérif (insécure). On vérifie toujours la **signature**.

### B. Supprimer les refetch complets sur les mutations fréquentes

**Principe** : ces actions sont déjà reflétées côté client (optimistic state + events du board). Retirer la revalidation/refresh évite le recalcul complet de page.

- **Server actions — retirer `revalidatePath`** : `update-card`, `update-card-field` (déjà sans revalidate), `update-card-due-date`, `checklist`, `advance-card`, `uncomplete-card`, `card-assignees`, `create-comment`, `update-comment`, `delete-comment`.
  - **Garder `revalidatePath`** sur les changements structurels mal couverts par le client : `create-project`, `delete-project`, `share-project-with-viewer`, `create-card`/`delete-card` **si** l'event board ne suffit pas (à vérifier — le board a déjà `CARD_CREATED_EVENT` / `CARD_REMOVED_EVENT`, donc on peut viser le retrait là aussi).
- **Composants — retirer `router.refresh()`** (9 fichiers : `card-comment-form`, `card-comment-item`, `card-advance-checkbox`, `card-completed-badge`, `card-modal`, `kanban-board`, `list-view`, `template-picker`, `share-project-modal`). Pour chacun : remplacer par mise à jour d'état local optimiste et/ou émission de l'event board approprié.
  - Cas par cas : si un composant a besoin de propager un changement à un autre (ex. avancement → board), utiliser le **système d'events existant** (`CARD_ADVANCED_EVENT`, etc.) plutôt qu'un refetch global.

> **Garde-fou** : pour chaque retrait, vérifier que l'état affiché reste cohérent sans rechargement. Si un cas n'est pas couvert par l'optimistic state/events, garder une revalidation **ciblée** (ou l'ajouter au système d'events) plutôt qu'un refetch global. Procéder action par action, en testant.

### C. Commentaires optimistes

**Fichiers** : `card-comments-thread.tsx`, `card-comment-form.tsx`, `card-comment-item.tsx`.

- Ajout : `useOptimistic` pour insérer le nouveau commentaire immédiatement (avant la réponse serveur), éditer en place, et marquer supprimé — au lieu de `router.refresh()`.
- L'auteur courant + ses droits (`isMine`, `canModerate`) sont déjà connus côté client (DTO) → on peut construire l'entrée optimiste localement.
- En cas d'échec serveur : rollback de l'entrée optimiste + message d'erreur (déjà géré par les états d'action).

### D. Alléger `reconcileBeforeRead`

**Fichiers** : `apps/web/features/projects/lib/reconcile.ts` + ses appelants.

- **Throttle par workspace** : n'exécuter `reconcileBeforeRead` qu'au plus une fois par fenêtre (~60 s) par workspace, via un timestamp léger (cache mémoire process, ou Upstash Redis si dispo). Les rendus rapprochés (navigations, refetch résiduels) sautent la réconciliation.
- Idempotent et déterministe → sauter quelques exécutions ne change pas la justesse (la prochaine fenêtre réconcilie). Une fois B en place, reconcile ne tourne plus à chaque mutation de toute façon.
- Garder l'exécution sur les vraies navigations (entrée sur la page projet/overview).

### E. (secondaire) Réduire les allers-retours Prisma par action

- Là où l'optimistic client a déjà la donnée, fusionner `findFirst` + `update` (un seul `update ... where workspaceId` qui échoue proprement si hors scope) ou paralléliser les lectures indépendantes. Optimisation fine, appliquée seulement si le gain est mesurable après A-D.

### Mesure (dev only)

- Petit utilitaire de timing (log `console.debug` derrière `NODE_ENV !== 'production'`) autour de 2-3 actions représentatives (edit titre, commentaire, avancement) pour objectiver le gain avant/après. Retiré ou laissé silencieux en prod.

## Ordre d'implémentation

A (auth locale) → B (retrait refetch) → C (commentaires optimistes) → D (throttle reconcile) → E (round-trips). **A + B ≈ 80% du gain ressenti.**

## Tests

- **Auth** (nouveau) : vérif JWT — token valide accepté, expiré rejeté, signature falsifiée rejetée, user supprimé (findUnique null) → non-authentifié. Mock du secret/JWKS.
- **Actions** : ajuster les tests existants dont on retire `revalidatePath` (les assertions `revalidatePath` sautent). Comportement métier inchangé.
- **Domain** : inchangé.
- **reconcile** : test du throttle (2 appels rapprochés → 1 seule exécution ; après la fenêtre → ré-exécution).

## Hors-scope

- Synchro temps-réel multi-utilisateur (Supabase Realtime) — chantier séparé ultérieur.
- Migration de région DB.
- Optimisations hors partie projet (overview/clients/team) — sauf l'auth qui bénéficie à toute l'app.

## Risques connus

- **Révocation ≤ 1h** hors actions destructrices (accepté, hybride).
- **Retrait des refetch** : risque de stale si l'optimistic state ne couvre pas un cas → mitigé en procédant action par action + garde-fou « revalidation ciblée si besoin ».
- **Throttle reconcile** : une carte en retard pourrait passer en Bloqué avec ≤60 s de retard d'affichage — négligeable.
- **getClaims vs HS256** : si le projet est en HS256 legacy, `getClaims()` peut retomber sur un appel réseau ; dans ce cas on bascule explicitement sur `jose.jwtVerify` + `SUPABASE_JWT_SECRET`. Confirmé à l'implémentation.

## Documentation associée

- Auth : `apps/web/lib/auth/index.ts`, `apps/web/lib/supabase/server.ts`
- Reconcile : `apps/web/features/projects/lib/reconcile.ts`
- Actions projet : `apps/web/features/projects/actions/*`
- Composants : `apps/web/features/projects/components/*`
- Mémoire pipeline deploy/migrations : `.claude/memory/reference_deploy_migrations.md`
