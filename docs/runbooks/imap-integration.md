# Runbook — Intégration IMAP générique

> **But** : connecter une boîte mail IMAP quelconque (OVH, Fastmail, iCloud,
> self-hosted…) à NexusHub pour lire les mails dans `/communications`, en
> complément de Microsoft Graph.
>
> **Quand l'utiliser** : avant le premier déploiement de la feature, pour
> ré-appliquer la migration sur un nouvel environnement, ou pour débugger un
> compte qui ne se connecte pas.
>
> **Références** : `docs/superpowers/specs/2026-05-28-email-foundations-design.md`,
> CLAUDE.md §4.2 (tokens/secrets chiffrés).

---

## 1. Overview

L'intégration IMAP offre une lecture (INBOX, lecture seule V1) de n'importe
quelle boîte mail supportant le protocole IMAP, en parallèle de Microsoft
Graph (Outlook/M365). Un utilisateur peut connecter **plusieurs boîtes IMAP**
(multi-mailbox), chacune apparaissant comme une `Integration` de kind `imap`
au côté des intégrations `graph` existantes. Les deux sources alimentent la
même table `EmailMessage` et sont fusionnées dans le panneau Communications
avec un filtre dropdown par boîte. Aucune infrastructure Microsoft/Azure
n'est impactée — Graph et IMAP sont des adapters indépendants qui partagent
uniquement l'allowlist de sanitize (`packages/integrations/src/mail/sanitize.ts`)
et le stockage chiffré des identifiants.

---

## 2. Variables d'environnement

**Aucune nouvelle variable d'environnement introduite par cette feature.**
L'intégration IMAP réutilise entièrement les variables déjà en place pour
Graph / le reste de la plateforme :

| Var                        | Purpose                                                               | Source                        |
| -------------------------- | --------------------------------------------------------------------- | ----------------------------- |
| `ENCRYPTION_KEY`           | Chiffrement AES-256-GCM des identifiants IMAP (mot de passe / secret) | Déjà en place (Graph)         |
| `UPSTASH_REDIS_REST_URL`   | Rate limiting de l'action `imap_test` (test de connexion)             | Déjà en place (rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | Idem                                                                  | Déjà en place                 |
| `NEXT_PUBLIC_APP_URL`      | Construction d'URLs absolues (redirects post-connexion, emails)       | Déjà en place                 |

---

## 3. Migration

### Migration folder

`packages/db/prisma/migrations/20260715142026_imap_integration_foundations/`

Ajoute (additif, sans casse) :

- `integrations.imap_uid_validity` (nullable) — détection de resync IMAP (UIDVALIDITY changé côté serveur)
- `integrations.imap_last_seen_uid` (nullable) — curseur de sync incrémentale
- `email_messages.integration_id` (FK) — rattache chaque message à l'intégration (Graph ou IMAP) qui l'a ingéré
- `IntegrationKind` enum étendu avec la valeur `imap`
- Backfill d'une contrainte « au plus 1 intégration Graph par workspace »
- 3 index sur `email_messages.integration_id` (unique combiné, composite de listing, FK cascade dédié)

### Pre-check (doit retourner 0 lignes)

Avant d'appliquer la migration (première application **ou** ré-application
sur un nouvel environnement), vérifier qu'aucun workspace n'a plus d'une
intégration Graph active — le backfill de la contrainte échoue sinon :

```sql
SELECT workspace_id, COUNT(*) FROM integrations WHERE kind = 'graph' GROUP BY workspace_id HAVING COUNT(*) > 1;
```

### Reconciliation si le pre-check échoue

Si des lignes apparaissent, ce sont presque toujours des lignes `revoked`
orphelines laissées par d'anciens tests de connexion / déconnexions. Les
supprimer à la main puis re-vérifier :

```sql
DELETE FROM integrations WHERE kind = 'graph' AND status = 'revoked' AND encrypted_tokens IS NULL;
```

Puis relancer le pre-check ci-dessus jusqu'à 0 ligne, avant de retenter la
migration.

> **Historique** : lors de l'application du 2026-07-15, 2 lignes Graph
> `revoked` orphelines ont été trouvées et supprimées via cette procédure
> (les lignes stales identifiées lors du pre-check du 2026-07-15).

### Apply

Coller le SQL du fichier de migration dans le SQL Editor Supabase → Run.
(Ou utiliser `apply_migration` via le MCP Supabase si disponible dans la
session.)

### Post-check

```sql
SELECT column_name FROM information_schema.columns WHERE (table_name='integrations' AND column_name IN ('imap_uid_validity','imap_last_seen_uid')) OR (table_name='email_messages' AND column_name='integration_id');
-- Attendu : 3 lignes

SELECT indexname FROM pg_indexes WHERE tablename='email_messages' AND indexname LIKE '%integration_id%';
-- Attendu : 3 lignes (unique + composite + FK cascade dédié)

SELECT unnest(enum_range(NULL::"IntegrationKind"));
-- Attendu : inclut 'imap'
```

### Statut

Appliquée sur le projet Supabase partagé (staging = prod) le **2026-07-15**.

---

## 4. Ajouter une boîte (parcours utilisateur)

- L'utilisateur va sur `/integrations` → clique « + Ajouter une boîte ».
- Il choisit `IMAP` dans le sélecteur de type d'intégration.
- Il entre son adresse email → l'autodiscover tente successivement la
  Mozilla ISPDB puis le `.well-known` du domaine.
- En cas d'échec de l'autodiscover, un formulaire manuel apparaît (host,
  port, TLS).
- L'utilisateur entre son mot de passe (ou mot de passe d'application selon
  le fournisseur).
- Il clique « Tester la connexion » (action `imap_test`, rate-limitée) → puis
  « Enregistrer » une fois le test réussi.

---

## 5. Problèmes de connexion courants

| Code      | Cause probable                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AUTH`    | Mot de passe incorrect, ou 2FA activée sans mot de passe d'application dédié                                              |
| `TLS`     | Port incohérent avec le mode TLS choisi (993 = TLS implicite ; 143 = STARTTLS, non pleinement supporté — recommander 993) |
| `HOST`    | Faute de frappe dans le host, ou résolution DNS échouée                                                                   |
| `TIMEOUT` | Serveur lent, ou notre IP bloquée côté fournisseur                                                                        |

---

## 6. Disconnect / Reconnect

- Déconnecter une boîte IMAP fait passer l'`Integration` en `status = 'revoked'` :
  - `encrypted_tokens = NULL`
  - `imap_uid_validity = NULL`, `imap_last_seen_uid = NULL`
- Les lignes `EmailMessage` associées **ne sont pas supprimées** (convention
  identique à Graph — préservation de l'historique/audit).
- Une reconnexion ultérieure crée une **nouvelle** ligne `Integration` (pas de
  réutilisation de l'ancienne ligne révoquée).

---

## 7. Rollback

Révoquer en urgence toutes les intégrations IMAP du workspace (ou de tout le
système) :

```sql
UPDATE integrations SET status='revoked', encrypted_tokens=NULL, imap_uid_validity=NULL, imap_last_seen_uid=NULL WHERE kind='imap';
```

Le rollback complet du schéma (suppression des colonnes ajoutées) est plus
lourd et nécessite une down-migration dédiée — généralement pas nécessaire
puisque les colonnes ajoutées sont nullable et inoffensives si inutilisées.

---

## 8. Sécurité

- Identifiants (host/port/user/password) chiffrés **AES-256-GCM** au repos,
  même mécanisme que les tokens OAuth Graph (`ENCRYPTION_KEY` + `key_version`).
- Action `imap_test` **rate-limitée** (Upstash Redis) pour éviter le brute-force
  de credentials via l'UI.
- TLS activé **par défaut** sur les connexions.
- Vérification d'**ownership** systématique dans chaque Server Action (le
  workspace/user courant doit être propriétaire de l'`Integration` ciblée).
- Audit log : `integration_connected` (avec `kind:imap`) / `integration_disconnected`,
  au même format que Graph.

---

## 9. See also

- [`microsoft-graph-integration.md`](./microsoft-graph-integration.md) — flow OAuth Graph, partage l'allowlist de sanitize avec IMAP
- `docs/superpowers/specs/2026-05-28-email-foundations-design.md` — spec de design Communications (fondations email)
