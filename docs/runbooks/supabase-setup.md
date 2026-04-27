# Runbook — Provisioning Supabase

> **Quand l'utiliser :** au démarrage (Phase 1.5 / Phase 2) pour créer les projets `nexushub-staging` et `nexushub-prod`.
> **Référence :** [ADR 0002](../adr/0002-auth.md), [ADR 0003](../adr/0003-db.md), [security.md](../security.md)

---

## Étape 1 — Créer les 2 projets Supabase

1. Aller sur <https://supabase.com/dashboard/projects>
2. **Create new project** → choisir l'organisation (ou en créer une : `Studio Atlas`)
3. **Pour staging :**
   - Name: `nexushub-staging`
   - Database password : **générer 32+ caractères aléatoires** (`openssl rand -base64 32`), **stocker dans 1Password**, jamais en clair
   - Region: `eu-central-1` (Frankfurt) — RGPD
   - Plan: **Free** suffit pour staging au démarrage (passer au Pro si besoin de PITR)
4. **Pour production :** idem mais
   - Name: `nexushub-prod`
   - Plan: **Pro** (PITR + backups quotidiens + 8 GB DB) — **après validation V1**

⏳ Attendre ~2 minutes que le projet soit provisionné.

---

## Étape 2 — Récupérer les valeurs (staging)

Aller dans `nexushub-staging` → **Settings → API** :

| Champ Vercel / `.env.local`     | Source Supabase           |        Sensibilité        |
| ------------------------------- | ------------------------- | :-----------------------: |
| `NEXT_PUBLIC_SUPABASE_URL`      | Project URL               |        🟢 publique        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon public` key         | 🟢 publique (RLS protège) |
| `SUPABASE_SERVICE_ROLE_KEY`     | `service_role secret`     |        🔴 critique        |
| `SUPABASE_JWT_SECRET`           | JWT Settings → JWT Secret |        🔴 critique        |

### Connection strings (UI Supabase 2025)

**Méthode rapide** : sur la page principale du projet, en haut à droite, cliquer sur **`Connect`** (bouton avec icône) → onglet **"ORMs"** → choisir **"Prisma"** dans le sélecteur.

**Méthode alternative** : `Settings` (engrenage en bas à gauche) → **Database** → **Connection string** dans la sidebar latérale.

Tu verras 3 modes. Récupérer **les deux suivants** :

| Mode dans Supabase                 |   Port   | Variable `.env.local` | Usage                            |
| ---------------------------------- | :------: | --------------------- | -------------------------------- |
| **Direct connection**              |   5432   | `DIRECT_URL`          | Migrations Prisma uniquement     |
| **Transaction pooler** (Supavisor) | **6543** | `DATABASE_URL`        | Runtime de l'app (edge-friendly) |

Format attendu :

```bash
DIRECT_URL="postgresql://postgres:[YOUR-PASSWORD]@db.<project-ref>.supabase.co:5432/postgres"
DATABASE_URL="postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
```

⚠️ **`[YOUR-PASSWORD]`** = le mot de passe DB défini à l'étape 1. Si perdu : `Settings → Database → Reset database password` (invalide les connexions actives, à éviter sauf urgence).

⚠️ Les URLs contiennent le mot de passe DB. **Ne jamais commit**, **ne jamais log**, jamais en `NEXT_PUBLIC_*`.

### Test de la connexion

```bash
# Test rapide depuis le repo
DATABASE_URL='...' DIRECT_URL='...' \
  pnpm --filter @nexushub/db exec prisma db pull --force
# Doit afficher "Introspecting based on datasource defined in prisma/schema.prisma"
# puis se terminer sans erreur (le schéma vide est attendu).
```

---

## Étape 3 — Configurer Auth (staging)

Aller dans **Authentication → Providers → Email** :

- ✅ Enable Email provider
- ❌ **Disable "Enable email confirmations"** — notre flow d'invitation custom valide l'email
- ❌ **Disable "Enable email signup"** — inscription publique interdite (PRD §3, Login)
- ✅ Enable "Secure email change"
- Minimum password length: **12** (renforce les défaults de Supabase)
- ✅ Enable "Leaked password protection" (HIBP)

Aller dans **Authentication → Sessions** :

- JWT expiry: **3600** (1 heure)
- ✅ Refresh token rotation: **ON**
- Reuse interval: **10** seconds

Aller dans **Authentication → URL Configuration** :

- Site URL: `http://localhost:3000` (staging) — modifier en prod
- Redirect URLs: `http://localhost:3000/**`

---

## Étape 4 — Configurer SMTP custom via Resend

(Cette étape peut attendre la Phase 2.3, mais autant la faire maintenant)

1. Créer un compte <https://resend.com>
2. Vérifier le domaine `mail.nexushub.app` (ou un sous-domaine acquis) — DNS TXT/MX à ajouter
3. Récupérer l'API key Resend (`re_...`) → variable `RESEND_API_KEY`
4. Dans Supabase → **Settings → Auth → SMTP Settings** :
   - Enable Custom SMTP: **ON**
   - Sender email: `invitations@mail.nexushub.app`
   - Sender name: `NexusHub`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: ton API key Resend (commence par `re_`)
5. Tester avec **Send a test email**

---

## Étape 5 — Créer le fichier `.env.local`

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS
cp .env.example .env.local
# Puis éditer .env.local avec les valeurs récupérées aux étapes 2 et 4.
```

**Générer les secrets locaux** (à coller dans `.env.local`) :

```bash
# AES-256 key (44 chars base64)
openssl rand -base64 32

# HMAC secret invitation (64 chars hex)
openssl rand -hex 32

# Web Push VAPID keys
npx web-push generate-vapid-keys
```

---

## Étape 6 — Vérification

```bash
# Le build doit passer avec les vraies valeurs (sinon Zod gronde dans lib/env.ts)
pnpm build

# Une fois le schéma Prisma écrit (Phase 2.1) :
pnpm --filter @nexushub/db db:push   # Schéma → Supabase
pnpm --filter @nexushub/db db:studio # GUI Prisma
```

---

## Étape 7 — Provisioning Vercel (plus tard, Phase 13)

Quand le déploiement staging est prêt :

1. <https://vercel.com> → Import Git Repository
2. Project Settings → Environment Variables → Importer toutes les variables de `.env.local` dans **Preview** (staging) et **Production** (prod, valeurs distinctes)
3. **Aucun secret dans le `.env` du repo.** Vercel gère le chiffrement.

---

## Sécurité — checklist post-setup

- [ ] DB password Supabase staging stocké en **1Password**
- [ ] DB password Supabase prod stocké en **1Password** (jamais le même)
- [ ] `service_role` keys notées dans security.md inventaire (rotations trimestrielles)
- [ ] `.env.local` jamais commité (vérifier `git status` après création)
- [ ] Région UE confirmée (RGPD)
- [ ] Email test envoyé via Resend → reçu

---

**Quand tu as fait ça, tu peux me donner le feu vert pour Phase 2 → je lancerai `prisma db push` pour appliquer le schéma sur staging.**

⚠️ **Note** : tu peux finir d'écrire le schéma Prisma sans Supabase (étape C que je fais maintenant). Le `db push` ne sera nécessaire qu'à la fin de la Phase 2.1.
