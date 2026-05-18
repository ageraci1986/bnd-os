# Runbook — Déploiement Vercel

> **But** : déployer NexusHub (`apps/web`) en production sur Vercel,
> avec le domaine `app.brandnewday.agency`.
>
> **Team Vercel** : `Angelo Geraci's projects` (slug
> `angelo-geracis-projects`, id `team_I8mEOjtPCErAjk20iv3QFzHE`)
>
> **Projet** : à créer sous le nom `nexushub`.

---

## 0. Pré-requis

- [x] Repo `bnd-os` poussé sur GitHub (`ageraci1986/bnd-os`)
- [x] Compte Vercel connecté à GitHub
- [x] Resend domaine `brandnewday.agency` vérifié (cf. runbook
      `resend-domain-setup.md`)
- [x] Supabase staging projet `bnd-os-staging` opérationnel
- [x] Variables d'env disponibles dans `.env.local` (à recopier vers
      Vercel)

---

## 1. Créer le projet Vercel (dashboard)

1. https://vercel.com/new → **Import Git Repository**
2. Sélectionne `ageraci1986/bnd-os` → **Import**
3. Configure dans le formulaire d'import :
   - **Project Name** : `nexushub`
   - **Framework Preset** : Next.js (auto-détecté)
   - **Root Directory** : `apps/web` → clique « Edit »
   - **Build & Output Settings** : laisse les défauts (Vercel détecte
     la monorepo pnpm et applique `next build` dans `apps/web/`)
   - **Install Command** : laisse vide (Vercel utilise
     `pnpm install --frozen-lockfile` automatiquement quand il détecte
     `pnpm-lock.yaml` à la racine)
   - **Node.js Version** : 22.x (cohérent avec `engines.node` du
     `package.json` racine)

4. **NE PAS encore cliquer Deploy** → on configure les env vars
   d'abord (sinon le 1er build échouera, ce n'est pas critique mais
   inutile).

---

## 2. Variables d'environnement

Dans le formulaire de création (ou Settings → Environment Variables
après création), ajouter ces clés pour `Production` ET `Preview`. Pour
chaque ligne : nom = valeur, type = `Encrypted` pour les secrets,
`Plain Text` pour les `NEXT_PUBLIC_*`.

### Obligatoires (build échouera sans elles)

| Variable                        | Valeur / Source                                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`           | `https://app.brandnewday.agency` (le domaine final ; pour les Preview deploys, Vercel utilise automatiquement `https://<preview-id>.vercel.app` quand cette var pointe vers la prod — alternative : variable différente par env) |
| `NEXT_PUBLIC_SUPABASE_URL`      | Dashboard Supabase → Settings → API → Project URL                                                                                                                                                                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dashboard Supabase → Settings → API → `anon` `public`                                                                                                                                                                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | Dashboard Supabase → Settings → API → `service_role` `secret` (⚠️ god-key, bypasse RLS)                                                                                                                                          |
| `SUPABASE_JWT_SECRET`           | Dashboard Supabase → Settings → API → JWT Settings → `JWT Secret`                                                                                                                                                                |
| `DATABASE_URL`                  | Dashboard Supabase → Settings → Database → Connection string → **Transaction** mode (port 6543, pgbouncer)                                                                                                                       |
| `DIRECT_URL`                    | Idem mais en mode **Session** (port 5432, direct)                                                                                                                                                                                |
| `ENCRYPTION_KEY`                | Idem `.env.local` (généré via `openssl rand -base64 32`, 44 chars)                                                                                                                                                               |
| `INVITATION_SECRET`             | Idem `.env.local` (généré via `openssl rand -hex 32`, 64 chars)                                                                                                                                                                  |

### Email (Resend — team NexusHub)

| Variable            | Valeur                                                 |
| ------------------- | ------------------------------------------------------ |
| `RESEND_API_KEY`    | Clé team NexusHub (cf. runbook resend-domain-setup §5) |
| `RESEND_FROM_EMAIL` | `app@brandnewday.agency`                               |
| `RESEND_FROM_NAME`  | `NexusHub`                                             |

### Optionnelles (peuvent rester vides pour le V1, le code tolère)

- `ENCRYPTION_KEY_VERSION` (défaut: `1`)
- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`
- `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID`,
  `GRAPH_REDIRECT_URI`
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`

> **Astuce** : tu peux importer ton `.env.local` en masse via le bouton
> « Import .env » dans la page « Environment Variables » de Vercel.
> Pense à **retirer les variables purement dev** (`NEXT_PUBLIC_APP_URL=http://localhost:3000`)
> avant l'import — ou à remplacer la valeur après import.

---

## 3. Premier déploiement

1. Clique **Deploy** → Vercel build et déploie
2. Le build typique prend 3–5 min :
   - `pnpm install --frozen-lockfile` à la racine
   - `postinstall` de `packages/db` → `prisma generate` (la modif du
     commit `XXXX` ajoute ce hook)
   - `next build` dans `apps/web/`
3. Une fois fini, Vercel ouvre `https://nexushub-<hash>.vercel.app` :
   - Test rapide : `/login` doit s'afficher correctement
   - Connecte-toi avec un compte Admin → vérifier que `/team`
     fonctionne (lit la DB Supabase staging)

### Si le build échoue

Logs : Vercel → Deployments → cliquer le déploiement échoué → onglet
**Logs**. Causes courantes :

- `Environment variable not found: DATABASE_URL` → une env var
  manque ou n'a pas le bon scope (Production vs Preview)
- `Cannot find module '@prisma/client'` → le `postinstall` n'a pas
  tourné. Vérifier que `packages/db/package.json` a bien
  `"postinstall": "prisma generate"`
- `Invalid server env: ENCRYPTION_KEY` → la clé n'est pas 44 chars
  base64. Recopier exactement depuis `.env.local`

---

## 4. Domaine personnalisé `app.brandnewday.agency`

### Côté Vercel

1. Projet `nexushub` → **Settings** → **Domains**
2. Champ « Add domain » → `app.brandnewday.agency` → **Add**
3. Vercel affiche les enregistrements DNS à poser → typiquement :
   - **CNAME** sur `app` → `cname.vercel-dns.com.`
   - Ou parfois **A** sur `app` → `76.76.21.21`
4. Note la valeur exacte (peut varier)

### Côté OVH (zone DNS de `brandnewday.agency`)

1. Espace client OVH → **Web Cloud** → **Domaines** → `brandnewday.agency`
   → onglet **Zone DNS** → **Ajouter une entrée**
2. Type : **CNAME** (cas le plus probable) → Suivant
3. Champs :
   - **Sous-domaine** : `app`
   - **TTL** : `300` (le temps de la vérif, puis 3600 plus tard)
   - **Cible** : `cname.vercel-dns.com.` (celle donnée par Vercel)
4. Valider

### Retour Vercel

- Attends 5–15 min la propagation DNS
- Vercel détecte automatiquement, statut passe en
  « **Valid Configuration** » et provisionne le certificat SSL
  (Let's Encrypt) en ~30s
- `https://app.brandnewday.agency` redirige alors vers le déploiement
  production

### Mise à jour `NEXT_PUBLIC_APP_URL`

Une fois le domaine validé, repasse dans Settings → Environment
Variables et confirme que `NEXT_PUBLIC_APP_URL=https://app.brandnewday.agency`
en Production. Re-deploy pour propager (Settings → Deployments →
les 3 points → **Redeploy**).

> Sinon les liens d'invitation pointeraient vers l'URL `*.vercel.app`
> au lieu du domaine final.

---

## 5. Smoke test end-to-end

1. `https://app.brandnewday.agency/login`
2. Login Admin
3. `/team` → invite une adresse externe
4. Vérifier :
   - Email reçu (expéditeur `NexusHub <app@brandnewday.agency>`)
   - Le lien d'acceptation pointe vers `app.brandnewday.agency` (pas
     localhost ni `.vercel.app`)
   - Acceptance → l'invité atterrit sur `/overview` ou `/my-projects`
     (selon rôle)
5. Dashboard Resend (team NexusHub) → **Logs** → status `Delivered`

---

## 6. Activer les déploiements automatiques

Vercel configure ça par défaut quand on importe un repo GitHub :

- **Push sur `main`** → déploiement Production automatique
- **Push sur autre branche / PR** → déploiement Preview automatique
- Le rollback se fait via Deployments → l'ancien déploiement → bouton
  **Promote to Production**

À vérifier dans Settings → Git → les options « Production Branch »
(devrait être `main`) et « Auto-assign Domains to Branches ».

---

## 7. Rollback / dégradation

Si une release casse la prod :

1. Vercel → Deployments → trouve le dernier déploiement sain
2. ⋯ → **Promote to Production** → instantané, pas de rebuild
3. Pendant ce temps, investigue le breaking change sur main ou
   reverte le commit incriminé

---

## 8. Documentation associée

- Runbook Resend : `docs/runbooks/resend-domain-setup.md`
- Runbook Supabase : `docs/runbooks/supabase-setup.md`
- Rotation des secrets : `docs/runbooks/secret-rotation.md`
