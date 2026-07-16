# Runbook — Intégration Microsoft Graph (Outlook)

> **See also:** [`imap-integration.md`](./imap-integration.md) for the generic IMAP flow. Both adapters share the sanitize allowlist at `packages/integrations/src/mail/sanitize.ts` — any change there affects both mail sources.
>
> **See also:** [`mail-send.md`](./mail-send.md) for outbound mail (Reply / Reply-All / Forward / Nouveau) across both mailbox kinds.

> **But** : connecter une boîte Outlook à NexusHub pour lire les mails dans `/communications`.
>
> **Quand l'utiliser** : avant le premier déploiement de la feature, ou pour
> rotation des secrets / debug d'un compte qui ne se connecte pas.
>
> **Références** : `docs/superpowers/specs/2026-05-28-email-foundations-design.md`,
> CLAUDE.md §4.2 (OAuth + tokens chiffrés).

---

## Prérequis Azure AD (Entra)

1. App registration sur https://entra.microsoft.com → App registrations → New registration.
2. Types de comptes supportés : **« Comptes dans n'importe quel annuaire d'organisation (multi-locataire) »** — couvre BrandNewDay + les comptes corporate externes (freelances, partenaires).
3. **Redirect URIs** (Authentication tab, plateforme Web) :
   - Production : `https://app.brandnewday.agency/api/oauth/graph/callback`
   - Local dev (port 3000) : `http://localhost:3000/api/oauth/graph/callback`
   - Local dev (port 3002) : `http://localhost:3002/api/oauth/graph/callback`
4. **Secret client** (Certificates & secrets → New client secret) : expiration ≤ 24 mois. ⚠ **Copier la VALEUR immédiatement** (Microsoft ne la réaffiche plus).
5. **Permissions API** (API permissions → Microsoft Graph → Delegated permissions) :
   - `Mail.Read`
   - `User.Read`
   - `offline_access`

   Aucune nécessite de consentement administrateur (chaque utilisateur consent pour lui-même au premier OAuth).

---

## Variables d'environnement

À mettre dans `.env.local` (dev) ET Vercel (Production + Preview) :

| Var                      | Source                                                          | Comment générer                                                        |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GRAPH_CLIENT_ID`        | Azure → Overview → Application (client) ID                      | (UUID, copie directe)                                                  |
| `GRAPH_CLIENT_SECRET`    | Azure → Certificates & secrets → la VALEUR copiée à la création | (1 seule chance de la copier)                                          |
| `ENCRYPTION_KEY`         | nouveau                                                         | `openssl rand -base64 32`                                              |
| `ENCRYPTION_KEY_VERSION` | défaut `1`                                                      | incrémenter à chaque rotation                                          |
| `OAUTH_STATE_SECRET`     | nouveau                                                         | `openssl rand -base64 32`                                              |
| `APP_URL`                | URL publique de l'app                                           | `https://app.brandnewday.agency` (prod), `http://localhost:3002` (dev) |

Toutes sont validées au boot par `apps/web/lib/env.ts` (schéma Zod). Une clé manquante ou trop courte → l'app refuse de démarrer.

---

## Migration DB

Avant le premier déploiement :

```bash
pnpm --filter @nexushub/db exec prisma migrate deploy
```

Ajoute (additif, sans casse) :

- `integrations.delta_token` (TEXT, nullable) — pour la sync incrémentale Graph
- `email_messages.deleted_at` (TIMESTAMPTZ, nullable) — soft-delete pour les `@removed` Graph
- `email_messages_workspace_id_deleted_at_idx` — index pour les listings filtrés
- `oauth_states.state` élargi de VARCHAR(128) à TEXT — accommode le payload HMAC signé

---

## Test rapide après déploiement

1. **Connexion** : aller sur `/integrations`, cliquer « Connecter ma boîte ».
2. Page de consentement Microsoft → accepter les 3 scopes.
3. Retour sur `/integrations?connected=graph` → la carte Outlook passe en « ● Connecté » avec l'email affiché.
4. **Lecture** : aller sur `/communications` → la première sync s'exécute (≤ 5 s sur DB rapide), la liste de mails apparaît dans le panneau gauche, auto-associés au bon client par domaine expéditeur.
5. Cliquer un mail → le lecteur s'ouvre à droite, le point « non lu » disparaît.
6. Cliquer « ↻ Actualiser » → sync incrémentale, indicateur « Sync il y a 0 min ».

---

## Sécurité (CLAUDE.md §4.2)

- Les access/refresh tokens sont **chiffrés AES-256-GCM** dans `integrations.encrypted_tokens` (format `v1:<keyVersion>:<iv>:<tag>:<ciphertext>`). Jamais loggés, jamais retournés via API.
- Le `state` OAuth est **HMAC-SHA256** + **single-use** (`oauth_states.consumed_at` est posé dans la transaction de callback, avant l'échange du code).
- Le callback `GET /api/oauth/graph/callback` rejette les states tampérés (400), expirés (400), et déjà consommés (400).
- Refresh rotation : à chaque refresh, le nouveau couple access+refresh écrase l'ancien en transaction. L'ancien refresh est révoqué côté Microsoft.
- Échec de refresh (revoked / 4xx) → `integrations.status = 'error'`, message « Reconnecte ta boîte » dans l'UI.
- Audit log : `integration_connected` / `integration_disconnected` écrits dans `audit_logs`.

---

## Rotation `ENCRYPTION_KEY`

1. Générer la nouvelle clé : `openssl rand -base64 32`.
2. Incrémenter `ENCRYPTION_KEY_VERSION` (ex. `1` → `2`).
3. Déployer (les NOUVEAUX tokens seront chiffrés avec la v2 ; les anciens restent v1).
4. (V1.5) Job manuel de re-chiffrement : décrypter chaque ligne avec la version qu'elle porte, re-chiffrer avec la nouvelle, écrire `key_version = 2`. Pas implémenté dans cette itération — la rotation propre passe par une décision opérationnelle.

---

## Disconnect / Reconnect

- L'utilisateur clique « Déconnecter » dans `/integrations` → `disconnectGraph` action :
  - `status = 'revoked'`
  - `encrypted_tokens = NULL`
  - `delta_token = NULL`, `last_synced_at = NULL`
  - Audit log écrit.
- Le row reste en DB (audit). Hard-delete prévu en V1.5 (job manuel).
- Pour reconnecter : la carte affiche « Précédemment connecté » + bouton « Connecter ma boîte » qui relance le flow OAuth.

---

## Hors-scope V1 (rappel)

Documenté pour éviter le scope creep en revue :

- ✅ Envoi de réponses (`Mail.Send`) → livré en itération 3, voir [`mail-send.md`](./mail-send.md)
- ❌ Templates email CRUD → itération 2
- ❌ Webhooks Graph (subscriptions, validationToken) → itération 3
- ❌ `isRead` writeback vers Outlook (V1 = lecture locale seulement)
- ❌ Pièces jointes, conversion email → carte, IA rédaction → V1.5+
- ❌ Multi-mailbox par user → V2

Voir le spec pour la liste complète.
