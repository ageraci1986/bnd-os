# Security — NexusHub

> Document maître de sécurité. Référencé par [CLAUDE.md §4](../CLAUDE.md). Mis à jour à chaque ADR ou incident.
>
> **Owner :** Angelo L.
> **Dernière mise à jour :** 2026-04-27

---

## 1. Périmètre

NexusHub manipule :

- **PII** : noms, emails, contacts clients
- **Contenu professionnel** : projets, tâches, mails, messages Slack
- **Tokens externes** : Slack OAuth, Microsoft Graph OAuth
- **Secrets serveur** : Supabase service-role, JWT secret, Inngest signing, Resend API key

Le risque principal est la **fuite cross-workspace** (multi-tenant), suivi de la **fuite de tokens externes** et du **détournement de session**.

---

## 2. Threat model (STRIDE — version courte)

| Threat                     | Vecteur                          | Mitigation                                                                                  |
| -------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| **S**poofing               | Session volée, JWT forgé         | Cookies httpOnly + Secure + SameSite=Lax, Supabase JWT vérifié serveur, CSRF double-submit  |
| **T**ampering              | Webhook Slack falsifié           | Signature HMAC `X-Slack-Signature` + timestamp < 5 min                                      |
| **R**epudiation            | Action contestée                 | Audit log immuable (table `audit_log`, append-only, hash chain en V1.5)                     |
| **I**nformation disclosure | Fuite cross-workspace            | RLS Postgres systématique + tests anon role en CI + lint custom Prisma                      |
| **D**enial of service      | Brute force login, flood webhook | Rate limit Upstash (login, invitation, reset, signup) + Vercel/Supabase rate limiting natif |
| **E**levation of privilege | Membre se promeut Admin          | Vérif rôle serveur + UI cachée + RLS, contrainte "dernier-Admin" via trigger Postgres       |

Threat model détaillé à finaliser en Phase 12 (audit).

---

## 3. Gestion des secrets

### Sources autorisées

| Environnement | Backend secret                                   | Frontend public |
| ------------- | ------------------------------------------------ | --------------- |
| Local dev     | `.env.local` (gitignored)                        | idem            |
| CI (build)    | GitHub Actions secrets (placeholders pour build) | idem            |
| Staging       | Vercel Encrypted Env (env Preview)               | idem            |
| Production    | Vercel Encrypted Env (env Production)            | idem            |

**Aucune autre source autorisée.** Pas de `.env` commité, pas de Notion/Drive, pas de DM Slack.

### Inventaire (Phase 1.5)

À chaque secret, un owner et une date de rotation. Voir [`runbooks/secret-rotation.md`](./runbooks/secret-rotation.md).

| Secret                      | Sensibilité |      Rotation cible       | Owner     |
| --------------------------- | :---------: | :-----------------------: | --------- |
| `SUPABASE_SERVICE_ROLE_KEY` | 🔴 critique |       trimestrielle       | Angelo L. |
| `SUPABASE_JWT_SECRET`       | 🔴 critique |       trimestrielle       | Angelo L. |
| `ENCRYPTION_KEY`            | 🔴 critique | annuelle (avec migration) | Angelo L. |
| `INVITATION_SECRET`         |  🟠 élevé   |       semestrielle        | Angelo L. |
| `RESEND_API_KEY`            |  🟠 élevé   |       semestrielle        | Angelo L. |
| `SLACK_SIGNING_SECRET`      |  🟠 élevé   | annuelle (rotation Slack) | Angelo L. |
| `GRAPH_CLIENT_SECRET`       |  🟠 élevé   |   semestrielle (Azure)    | Angelo L. |
| `INNGEST_SIGNING_KEY`       |  🟡 moyen   |       semestrielle        | Angelo L. |
| `UPSTASH_REDIS_REST_TOKEN`  |  🟡 moyen   |         annuelle          | Angelo L. |
| `SENTRY_AUTH_TOKEN`         |  🟡 moyen   |         annuelle          | Angelo L. |

### Détection automatique

- **Pre-commit** : `gitleaks` avec rules custom pour `xox[abprs]-`, `re_`, `eyJ...service_role`, etc.
- **CI** : `gitleaks-action` (PR + push)
- **CodeQL** : analyse statique JS/TS
- **Semgrep** : `p/owasp-top-ten` + `p/secrets`
- **Sentry `beforeSend`** : filtre les clés `password|token|key|secret|authorization` avant envoi

---

## 4. Tokens OAuth (Slack, Graph)

1. Stockage **chiffré AES-256-GCM** dans `Integration.encrypted_tokens` avec colonne `key_version`.
2. **Refresh rotation** : à chaque refresh, l'ancien token est révoqué et le nouveau remplace en transaction.
3. **State OAuth** : nonce 32 bytes + signature HMAC, stocké en Redis (Upstash) TTL 10 min, single-use.
4. **Webhook Slack** : vérification `v0=` + timestamp < 5 min.
5. **Webhook Graph** : `validationToken` au handshake + `clientState` à chaque notification.
6. **Logs** : aucun token n'apparaît dans les logs (filtre Sentry + lint).

---

## 5. Multi-tenant — RLS Postgres

Politique générique (mise en place en Phase 2.1) :

```sql
-- Activée sur chaque table métier
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

-- Policy SELECT
CREATE POLICY "Members can read"
  ON public.<table> FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- Idem INSERT / UPDATE / DELETE avec WITH CHECK
```

**Tests automatisés en CI :**

- Connexion en tant que rôle `anon` → `SELECT * FROM cards` doit retourner 0 ligne
- Connexion en tant qu'`authenticated` user du workspace A → impossible de lire les cards du workspace B
- Tests sur 100 % des tables applicatives

---

## 6. Réponse à incident

Voir [`runbooks/incident-response.md`](./runbooks/incident-response.md).

Procédure synthétique :

1. **Détection** (Sentry alerte, monitoring Vercel, signalement utilisateur)
2. **Confinement** (rotation immédiate des secrets concernés, désactivation de la fonctionnalité incriminée)
3. **Éradication** (correctif + test de non-régression sécurité)
4. **Restauration** (déploiement hotfix, vérification fonctionnelle)
5. **Postmortem** (sous 5 jours ouvrés, partage interne, mise à jour ce document)

---

## 7. Audit & conformité

- **WCAG 2.1 AA** côté accessibilité (contrôlé en Phase 11 par axe-core + Lighthouse).
- **RGPD** : DPA signés avec Supabase, Vercel, Resend, Sentry, Upstash, Inngest. Données hébergées en UE.
- **SBOM** : généré à chaque release (`cyclonedx`), archivé dans GitHub Releases.
- **Pen-test interne** : Phase 12.

---

## 8. Journal des modifications de ce document

| Date       | Modification                                         | Auteur            |
| ---------- | ---------------------------------------------------- | ----------------- |
| 2026-04-27 | Version initiale (squelette à compléter en Phase 12) | Claude (Opus 4.7) |
