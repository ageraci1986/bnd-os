# Communications · Email Foundations — Design Spec

> **Date** : 2026-05-28
> **Branche** : `feature/email-foundations` (à créer)
> **Itération** : 1/N (fondations connecter + lire ; envoi en itération 2, webhooks temps-réel en itération 3)
> **PRD** : §306 Communications, §434 Microsoft Exchange
> **Sécurité** : conforme CLAUDE.md §4.2 (OAuth + tokens chiffrés)

---

## 1. But

Permettre à un utilisateur de **connecter sa boîte Outlook professionnelle** (Microsoft Exchange via Graph API, OAuth délégué) à NexusHub, et **lire ses mails clients centralisés dans `/communications`** — auto-associés au bon client via les domaines.

Aucun envoi, aucun template, aucun temps-réel : c'est la fondation qui débloque les itérations suivantes.

## 2. Périmètre

### Inclus (V1 — cette itération)

- OAuth Microsoft Graph (délégué, par utilisateur, multi-tenant work/school).
- Sync initiale **inbox 30 derniers jours, max 200 messages**.
- Sync incrémentale via Graph **delta query**, déclenchée à l'ouverture de `/communications` + bouton « Actualiser ».
- Page `/integrations` (canonique) : carte Microsoft Outlook avec états _inactive / connected / error_.
- Page `/communications` : onglet Mails (les onglets Slack / Notes restent désactivés "bientôt"), liste à gauche, lecteur à droite, empty state quand pas connecté.
- Auto-association email → client par **domaine expéditeur** matchant `Client.emailDomains`. Non matché → `clientId = null`, visible seulement en vue tous-clients.
- `isRead` mis à jour **localement uniquement** (pas de writeback vers Outlook en V1).
- Disconnect + reconnect.

### Hors-scope (itérations ultérieures, documenté pour éviter le scope creep)

- ❌ Envoi / réponse (Graph `sendMail`) → itération 2.
- ❌ Templates email CRUD → itération 2.
- ❌ Webhooks Graph (subscriptions + validationToken) → itération 3.
- ❌ `isRead` writeback vers Outlook → itération 2/3.
- ❌ Pièces jointes (download, preview) → V1.5.
- ❌ Conversion email → carte Kanban → V1.5.
- ❌ IA Aide rédaction → V1.5.
- ❌ Multi-mailbox par user (secondaires, partagées) → V2.
- ❌ Folder _Sent_ / _Drafts_ (vient avec l'envoi en iter 2).
- ❌ Slack workspace integration (branche séparée).
- ❌ Rate limiting Upstash Redis (la table `OAuthState` suffit en V1).

## 3. Architecture

### Pattern hexagonal (cohérent avec l'existant)

```
packages/integrations/graph/        ← adaptateur pur, sans dépendance Next
  ├─ client.ts                       fetch wrapper + retry/backoff
  ├─ auth.ts                         exchange code → tokens, refresh
  ├─ messages.ts                     list inbox, delta query, parse
  └─ index.ts                        public API

apps/web/lib/oauth/                  ← réutilisable (Slack arrive plus tard)
  ├─ state.ts                        HMAC sign/verify du `state`
  └─ crypto.ts                       AES-256-GCM encrypt/decrypt

apps/web/features/integrations/      ← OAuth & connexions (générique, réutilisable Slack/Fireflies)
  ├─ actions/
  │   ├─ start-graph-oauth.ts        action déclenchant le redirect MS
  │   └─ disconnect-graph.ts         révoque + nettoie tokens
  └─ components/
      ├─ integrations-grid.tsx
      └─ outlook-card.tsx            les 3 états (inactive/active/error)

apps/web/features/communications/    ← lecture mailbox (spécifique email)
  ├─ actions/
  │   ├─ sync-graph-inbox.ts         orchestrateur sync (delta ou initiale)
  │   └─ mark-email-read.ts          flip isRead localement
  ├─ lib/
  │   ├─ auto-associate.ts           domaine → clientId
  │   └─ mail-dto.ts                 EmailMessage → UI DTO
  └─ components/
      ├─ mail-list.tsx               panneau gauche
      ├─ mail-reader.tsx             panneau droit
      ├─ mail-tabs.tsx               header tabs + refresh
      └─ empty-no-integration.tsx    empty state

apps/web/app/api/oauth/graph/callback/route.ts   ← route handler (HTTP redirect)

apps/web/app/(app)/integrations/page.tsx         ← remplace placeholder
apps/web/app/(app)/communications/page.tsx       ← remplace placeholder
```

### Flux global

```
[User] → /integrations → "Connecter ma boîte"
   ↓ server action startGraphOAuth
   ↓   • génère nonce + state HMAC (OAUTH_STATE_SECRET)
   ↓   • insère ligne dans OAuthState (TTL 10min, consumedAt null)
   ↓   • redirect 302 vers login.microsoftonline.com/common/oauth2/v2.0/authorize
[MS consent screen] → user accepte les 3 scopes
   ↓ redirect vers /api/oauth/graph/callback?code=...&state=...
[Route handler] valide state HMAC + lookup DB + consumed + exp
   ↓ POST /oauth2/v2.0/token avec code + client_secret
   ↓ GET /me → externalAccountLabel
   ↓ AES-256-GCM encrypt({access, refresh, expires_at, scopes})
   ↓ upsert Integration(kind=graph, scope=user, ownerUserId=ctx.userId, ...)
   ↓ marque OAuthState consumed
   ↓ audit log integration_connected
   ↓ redirect /integrations?connected=graph
[User] → /communications
   ↓ Server Component charge :
   ↓   • Integration du user (status=active)
   ↓   • Si pas d'integration → empty state
   ↓   • Sinon : syncGraphInbox si lastSyncedAt > 30s → ré-render → liste
```

## 4. Prérequis

### Azure AD (à faire AVANT l'implémentation — ✅ déjà fait par l'utilisateur)

- App registration multi-tenant work/school (`/common`).
- Redirect URIs : `https://app.brandnewday.agency/api/oauth/graph/callback`, `http://localhost:3000/api/oauth/graph/callback`, `http://localhost:3002/api/oauth/graph/callback`.
- Client secret généré (valeur copiée une fois — ne se réaffiche pas).
- Permissions Graph déléguées : `Mail.Read`, `User.Read`, `offline_access` (toutes 3 sans consentement admin requis).

### Variables d'environnement

Déjà déclarées dans `apps/web/lib/env.ts` (vérifié) :

- `GRAPH_CLIENT_ID` — Application (client) ID de l'app Azure.
- `GRAPH_CLIENT_SECRET` — Valeur du secret client.
- `ENCRYPTION_KEY` — 32 bytes base64 (validation Zod, min 44 chars).
- `ENCRYPTION_KEY_VERSION` — défaut `1`, mappe sur `Integration.keyVersion`.

À **ajouter** au schéma `env.ts` :

- `OAUTH_STATE_SECRET` — 32 bytes base64, pour HMAC du `state` OAuth.

Toutes ces vars doivent être présentes dans `.env.local` (dev) **et** Vercel (Production + Preview). Le runbook ajouté à `docs/runbooks/` documentera les commandes `openssl rand -base64 32`.

## 5. OAuth flow & sécurité

### Endpoint MS (multi-tenant work/school)

- Authorize : `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
- Token : `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- Scopes demandés : `offline_access User.Read Mail.Read` (+ `openid` implicite).

### `state` OAuth — HMAC + table DB

- Payload signé : `{ workspaceId, userId, nonce: 16 random bytes, returnTo, exp: now+10min }`.
- Signature : HMAC-SHA256(`OAUTH_STATE_SECRET`).
- Stockage : ligne dans `OAuthState` (table déjà au schéma). `state` = `<payload_b64url>.<hmac_b64url>`.
- Single-use : `consumedAt` set par la transaction de callback.
- TTL appliqué via `expiresAt` (10 min).

### Chiffrement des tokens — AES-256-GCM

- Clé : `ENCRYPTION_KEY` (32 bytes décodée du base64).
- IV : 12 bytes random par chiffrement.
- Format ciphertext (texte stocké dans `Integration.encryptedTokens`) :
  ```
  v1:<keyVersion>:<iv_b64>:<tag_b64>:<ciphertext_b64>
  ```
- `keyVersion` (de `ENCRYPTION_KEY_VERSION`) permet rotation : la décryption tente la clé correspondant à la version, fallback sur les clés précédentes (V1.5).
- Payload chiffré (JSON) : `{ accessToken, refreshToken, expiresAt: ISO, grantedScopes: string[] }`.
- **Jamais loggé**, jamais retourné via API.

### Refresh token rotation

- Helper `getValidAccessToken(integrationId)` :
  - Charge la ligne `Integration`, décrypte.
  - Si `expiresAt < now + 60s` → POST refresh sur `/oauth2/v2.0/token` avec `grant_type=refresh_token`.
  - Microsoft rotate (l'ancien refresh est révoqué côté MS).
  - Ré-encrypte la nouvelle paire `{access, refresh, expires_at}` → update Integration en transaction.
  - Échec (révoqué, 4xx) → `status='error'`, `lastError` rempli, throw `GraphIntegrationRevoked` que les actions traduisent en `{ok:false, message:"Reconnecte ta boîte"}`.
- Pas de mutex multi-instance en V1 (deux refresh concurrents écraseraient l'un l'autre — peu probable au scale actuel, MS retournera 400 sur l'un des deux et on relancera la rotation au prochain appel).

### Disconnect

- Server action `disconnectGraph(integrationId)` :
  - Best-effort : POST `https://graph.microsoft.com/v1.0/me/revokeSignInSessions` (révoque toutes les sessions ; pas de revoke per-refresh-token dans Graph public).
  - Update `Integration.status = 'revoked'`, blanchit `encryptedTokens` (mais garde la ligne pour audit).
  - Audit log `integration_disconnected`.
  - Suppression hard-delete après 30 jours (job manuel V1.5).

### Garde-fous

- Origin/Referer du callback vérifié (défense en profondeur, en plus du `state` HMAC).
- Toutes les actions passent par `requireUser`.
- Les requêtes Prisma sur `Integration` ET `EmailMessage` incluent **toujours** `where: { workspaceId: ctx.workspaceId }` (multi-tenant CLAUDE.md §4.4.2).
- Pour `Integration`, on filtre **aussi** sur `ownerUserId: ctx.userId` (intégrations user-scope strictement personnelles).
- Audit log : `integration_connected`, `integration_disconnected` (déjà au schéma `AuditAction`).
- Aucun secret dans les messages d'erreur retournés au client.

## 6. Sync mailbox

### Endpoints Graph

- **Sync initiale** (jamais syncé) :

  ```
  GET https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages
    ?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,
            isRead,conversationId,bodyPreview,body
    &$orderby=receivedDateTime desc
    &$filter=receivedDateTime ge <30j-ago-ISO>
    &$top=50
  ```

  Suit `@odata.nextLink` jusqu'à **max 200 messages**.

- **Sync delta** (post-initiale) :
  ```
  GET https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta
  ```
  Premier appel renvoie un `@odata.deltaLink` → stocké dans `Integration.deltaToken` (champ à ajouter, voir §8). Appels suivants utilisent ce lien et ne retournent que les changements.
  Si la réponse contient 410 Gone (token expiré, > ~6 mois) → reset `deltaToken=null` → repartir d'une sync initiale.

### Server action `syncGraphInbox()`

1. `requireUser()` → ctx.
2. Charge `Integration` (kind=graph, owner=user, status=active). Si absent ou error → return `{ok:false}`.
3. Throttle : si `lastSyncedAt > now - 30s` → no-op succès (évite spam refresh).
4. `getValidAccessToken()` → token frais.
5. Branche initiale ou delta selon `deltaToken`.
6. Pour chaque message reçu :
   - **Sanitize HTML** body via `sanitize-html` (même config que pour les commentaires de carte).
   - Extraire `bodyText` (plain).
   - **Auto-association** (cf. ci-dessous).
   - **Upsert** `EmailMessage` par `(workspaceId, externalId)`.
   - Si flag `@removed` → soft-delete (nouveau champ `deletedAt` à ajouter à `EmailMessage` ; sinon DELETE hard).
7. Update `Integration.lastSyncedAt = now`, `deltaToken = nouveau lien`.
8. Erreurs :
   - 401 → `status='error'`, `lastError='Token révoqué — reconnecte ta boîte'`.
   - 429 / 5xx → retry exponentiel max 3 (1s, 2s, 4s) puis garder l'état précédent.
   - Réseau → toast UI, état inchangé.

### Auto-association par domaine

Module pur `lib/auto-associate.ts`, testable sans DB :

```ts
function matchClientByDomain(
  fromEmail: string,
  clientsByDomain: Map<string, ClientId[]>, // pre-built per workspace
): ClientId | null {
  const at = fromEmail.lastIndexOf('@');
  if (at < 0) return null;
  const domain = fromEmail.slice(at + 1).toLowerCase();
  const candidates = clientsByDomain.get(domain);
  if (!candidates || candidates.length === 0) return null;
  // Conflit (plusieurs clients sur le même domaine) : premier match
  // déterministe (clientsByDomain garde l'ordre createdAt asc).
  return candidates[0];
}
```

- Pré-charge `clientsByDomain` une fois par sync (1 query Prisma sur `Client` + filtre `deletedAt: null`).
- Match exact uniquement (`@dev.acme.com` ne match pas `acme.com`). Sous-domaines : V1.5.
- Pas de match → `clientId = null` ; le message est visible **uniquement en vue tous-clients**.

## 7. UI

### Règle absolue : tokens du design system

**Aucune valeur hex en dur dans l'implémentation.** Toutes les couleurs, ombres, rayons passent par les variables CSS du design system (mappées depuis `mockups/styles.css`) ou les utilitaires Tailwind correspondants. Les approximations des maquettes visual companion (`#8b5cf6`, `#1a1633`…) sont à remplacer par les tokens (`var(--color-accent-primary)`, `var(--color-text-main)`, etc.) lors du codage. Vérifier la cohérence avec les composants existants (Kanban card, modal carte) avant tout `style={{}}`.

### `/integrations` (remplace placeholder)

- **Server Component** (page.tsx) : charge `Integration` du user pour kind=graph + workspace-level. Render grille.
- **Composant `OutlookCard`** (Client Component pour le bouton) :
  - État `inactive` : titre + sous-titre + bouton `Connecter ma boîte` qui submit `<form action={startGraphOAuth}>`.
  - État `active` : badge vert ● Connecté, `external_account_label` (email), `last_synced_at` relatif, bouton `Déconnecter` (confirm modal).
  - État `error` : badge rouge ● Erreur + `last_error` lisible, bouton `Reconnecter` (= startGraphOAuth re-déclenché).
  - État `revoked` : comme `inactive` + mention « Précédemment connecté ».
- Slack / Fireflies / Otter restent en placeholder « Bientôt ».
- Toasts :
  - `?connected=graph` → toast vert « Boîte connectée ».
  - `?error=<code>` → toast rouge mapped à un message human-readable.

### `/communications` (remplace placeholder)

- Layout 2 colonnes (cf. PRD §306 + maquettes validées).
- **Server Component** (page.tsx) :
  1. `requireUser` + filtre client global (depuis searchParams ou stores serveur).
  2. Charge `Integration` user.
  3. Si pas d'intégration ou status non `active` → `<EmptyNoIntegration />` (lien vers `/integrations`).
  4. Sinon, déclenche `syncGraphInbox` si `lastSyncedAt < now - 30s` (cohérent avec le pattern `reconcileBeforeRead`).
  5. Charge `EmailMessage` du workspace (filtrés par client si chip actif), ordre `receivedAt DESC`, limit 200.
  6. Render `<MailTabs />` + `<MailList />` + `<MailReader />`.

- **`MailTabs`** : 3 onglets (Mails actif · Slack disabled · Notes disabled) + bouton « Actualiser » (Client Component, déclenche `syncGraphInbox` + `router.refresh()`) + indicateur « Sync il y a Xm · N mails ».

- **`MailList`** (Client Component léger pour la sélection + isRead optimiste) :
  - Items triés `receivedAt DESC`, item visuel = unread dot (`!isRead`), sender, time (relative ≤ 24h sinon date courte), client badge coloré (en vue tous-clients), subject, preview.
  - Click → sélectionne (state local), optimiste `isRead=true`, server action `markEmailRead` en arrière-plan (idempotent).

- **`MailReader`** :
  - Empty state si rien sélectionné : « Sélectionne un mail à gauche ».
  - Sinon : sujet, expéditeur (avatar initiales + nom + email + badge client), date complète, body (`bodyHtmlSanitized` rendu via `dangerouslySetInnerHTML` car déjà sanitized → wrap dans `<div class="email-body">` avec scoping CSS pour éviter qu'il pollue l'app), TO/CC repliable.
  - Placeholder grisé « Répondre — bientôt ».

- **Filtre client global** : le chip du shell filtre `clientId` en SSR (`where: { clientId: <id> }`). Pas de filtre → tous + ceux avec `clientId=null` (avec badge "Sans client").

- **Performance** : avec 200 messages max et la DB rapide, la page render < 500 ms (cohérent avec les autres pages du projet). Pas de virtualization nécessaire en V1.

### Toasts d'erreur communs

- `Token révoqué — reconnecte ta boîte` (lien direct vers `/integrations`).
- `Sync échouée — réessaye dans un instant` (réseau, 5xx).
- `Limite Graph atteinte, retry dans Xs` (429, rare).

## 8. Data model — migrations

Toutes les migrations sont **additives** (non destructives) :

### Migration 1 — `Integration.deltaToken`

```prisma
model Integration {
  // ... champs existants ...
  deltaToken String? @map("delta_token")
  // ...
}
```

SQL : `ALTER TABLE integrations ADD COLUMN delta_token TEXT;`

### Migration 2 — `EmailMessage` : unique + soft-delete

À vérifier que ces deux contraintes sont présentes ; si non, ajouter :

```prisma
model EmailMessage {
  // ... champs existants ...
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)
  // ...
  @@unique([workspaceId, externalId])
}
```

### Pas de nouvelle table

`Integration`, `OAuthState`, `EmailMessage`, `EmailTemplate`, `Client.emailDomains` couvrent tout.

## 9. Plan de tests

### Tests unitaires (`packages/integrations/graph/` + `apps/web/lib/oauth/`)

100% coverage cible, sans DB :

- `crypto.ts` : `encrypt`/`decrypt` AES-256-GCM round-trip ; tampering du ciphertext rejeté ; mauvaise clé rejetée ; mauvaise version rejetée.
- `state.ts` : `sign`/`verify` HMAC ; signature falsifiée rejetée ; expiration respectée ; payload mal formé rejeté.
- `parse-message.ts` (extract du payload Graph) : tous champs présents, manquants gérés (`fromName` optionnel), dates parsées en ISO, sanitization HTML appliquée.
- `auto-associate.ts` : match simple, conflit multi-clients (premier déterministe), pas de match → null, casse insensible, email malformé → null.

### Tests d'intégration (Vitest + mocks `fetch`)

- `startGraphOAuth` → insère `OAuthState`, retourne redirect URL avec params attendus.
- Callback route handler :
  - State valide + code mocké → tokens reçus, Integration upsert, OAuthState consommé, redirect succès.
  - State invalide (HMAC), expiré, déjà consommé → 400.
- `syncGraphInbox` (avec mock `fetch` Graph) :
  - Initiale : insère N EmailMessage, clientId auto-assigné, `deltaToken` set.
  - Delta : seuls les changements appliqués, `deltaToken` mis à jour.
  - 401 → `Integration.status='error'`, `lastError` rempli.
  - Throttle 30s respecté.
- `markEmailRead` : flip isRead, gate scope/role respecté.
- `disconnectGraph` : status revoked, encryptedTokens blanchi, audit log écrit.

### Tests E2E (Playwright) — 1 parcours

- User authentifié → `/integrations` → empty Outlook card.
- Click « Connecter » → mock du flow Microsoft (intercept la redirection) → callback intercepté → revient sur `/integrations` connecté.
- Va sur `/communications` → voit la liste de mails mockés (auto-assignés au bon client).
- Click un mail → reader rempli, `isRead` flip visuellement.
- Click « Actualiser » → toast / indicateur de fraîcheur updaté.

### Couverture cible

- `packages/integrations/graph/` : 100 % lignes / branches.
- `apps/web/lib/oauth/` : 100 %.
- Actions web : 80 %+.

## 10. Décisions verrouillées (référence)

| #   | Décision                                                                                      | Justification                                             |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Itération « connecter + lire » seule, pas d'envoi                                             | Périmètre livrable indépendant ; envoi en iter 2          |
| 2   | Sync à l'ouverture + bouton refresh, throttle 30s                                             | Pas d'infra de jobs ; webhooks en iter 3                  |
| 3   | Inbox 30j max 200 messages                                                                    | Volume DB contenu ; quota Graph faible                    |
| 4   | `/integrations` canonique + `/communications` empty state lien                                | Structure PRD ; réutilisable Slack                        |
| 5   | Auto-assoc par domaine sender seul ; non matchés `clientId=null` visibles en vue tous-clients | Simple, déterministe                                      |
| 6   | Azure AD multi-tenant work/school (`/common`)                                                 | Couvre tenant interne + collaborateurs externes corporate |
| 7   | `OAuthState` table DB (pas Redis V1)                                                          | Pas de dépendance Upstash ; concurrence faible            |
| 8   | `isRead` local uniquement, pas de writeback Graph                                             | Simplicité V1 ; writeback en iter 2/3                     |
| 9   | Tokens chiffrés AES-256-GCM via `ENCRYPTION_KEY` existant                                     | CLAUDE.md §4.2.1                                          |
| 10  | `OAUTH_STATE_SECRET` séparé pour HMAC du state                                                | Séparation des préoccupations                             |
| 11  | Tokens design system obligatoires (zéro hex en dur)                                           | CLAUDE.md §2 frontend                                     |

## 11. Out of scope reminders (rappel V1.5+)

- Envoi de réponses (`Mail.Send` scope + UI composer + templates).
- Webhooks Graph (`/subscriptions` + endpoint validationToken + clientState).
- Pièces jointes (download, upload, preview).
- Conversion email → carte Kanban (« → Tâche »).
- IA aide rédaction.
- Multi-mailbox (boîtes secondaires, partagées).
- Folders Sent + Drafts.
- `isRead` writeback Graph.
- Sous-domaines dans l'auto-assoc.
- Slack workspace integration (branche séparée).

---

**Fin du spec.** Le plan d'implémentation détaillera les tâches bite-sized à partir de ce design.
