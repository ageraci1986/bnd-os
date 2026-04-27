# Runbook — Local dev quickstart

> **Quand l'utiliser :** la première fois que tu démarres l'app en local (Phase 2.5+), pour valider le flow auth + invitation de bout en bout.
>
> **Prérequis :** Supabase staging configuré (cf. [`supabase-setup.md`](./supabase-setup.md)) + `.env.local` rempli + migrations Prisma appliquées (déjà fait).

---

## 1. Générer le client Prisma

```bash
pnpm --filter @nexushub/db db:generate
```

## 2. (Optionnel) Seed le workspace de démo

Crée le workspace `Studio Atlas` + 5 clients + 14 projets + types + templates.

```bash
pnpm --filter @nexushub/db db:seed
```

Si tu veux juste un workspace vide, tu peux skipper. Le bootstrap admin créera lui-même le workspace nécessaire (mais le seed est plus rapide pour avoir un environnement complet).

> ⚠ **Le seed efface et recrée le workspace** `studio-atlas`. Ne le lance pas en production.

## 3. Bootstrap le premier Admin

Crée le premier user **Admin** sur le workspace `studio-atlas`. Ce user est l'unique entrée pour ensuite inviter les autres via l'UI.

```bash
pnpm --filter @nexushub/db db:bootstrap-admin \
  --email "ageraci.finance@gmail.com" \
  --password "tonMotDePasse12caracteresMin"
```

> ⚠ **Mot de passe ≥ 12 caractères** (cohérent avec le réglage Supabase Auth dashboard).

Le script :

- Crée le user via `supabase.auth.admin.createUser()` (email confirmé d'office)
- Le DB trigger `handle_new_auth_user` mirror dans `public.users`
- Upsert un `Membership { role: admin }` dans le workspace `studio-atlas`
- Idempotent : tu peux le relancer plusieurs fois sans crash

## 4. Lancer l'app

⚠️ **Première fois seulement** — Next.js 15 cherche `.env.local` dans `apps/web/`. Crée un symlink vers le `.env.local` racine :

```bash
ln -sf ../../.env.local apps/web/.env.local
```

Puis lance le dev server :

```bash
pnpm dev
# http://localhost:3000
```

> Au boot tu dois voir `▲ Next.js 15.x ... - Environments: .env.local` — sinon le fichier n'est pas chargé et toutes les vars sont undefined côté serveur.

## 5. Tester le flow complet

### a. Connexion

1. Ouvre <http://localhost:3000>
2. Clique **"Se connecter"** → tu arrives sur `/login`
3. Saisis l'email + password de l'Admin → tu es redirigé sur `/overview`
4. Vérifie : la topbar affiche ton nom + rôle "Admin", lien **Équipe** visible

### b. Créer une invitation

1. Clique **"Équipe"** → `/team`
2. Saisis un email de test (idéalement une boîte que tu contrôles, ex : `+test@gmail.com`) + rôle "Membre"
3. Clique **"Inviter"** → message vert : "Invitation envoyée à …"

### c. Récupérer le lien d'invitation (sans Resend)

Sans Resend configuré, l'email **n'est pas envoyé** par mail. Le serveur log l'envoi en console :

```
[email:dev] would send to=foo@example.com tag=invitation subject="Vous êtes invité..." preview="Bonjour, ..."
```

Pour récupérer le lien clair (qui n'est **jamais** stocké en DB), deux options :

**Option A — patch temporaire dev** : ajouter un `console.log` du `acceptUrl` dans `apps/web/features/invitations/actions/create-invitation.ts` (pense à le retirer avant le commit).

**Option B — re-créer une invitation via un script ad-hoc** qui logge le clear token. Recommandé en V1.5 quand on aura un mode "dev: print URL".

> 🪄 **Mieux** : configure Resend dès que possible. C'est 2 minutes et tu reçois les vrais emails.

### d. Accepter l'invitation

1. Ouvre `http://localhost:3000/signup/<token>` (le token clair récupéré ci-dessus)
2. La page affiche le nom du workspace + l'inviteur
3. Saisis prénom + nom + mot de passe (≥ 12 chars) + accepte les CGU
4. Clique **"Créer mon compte"** → tu es **automatiquement connecté** comme Membre

### e. Se déconnecter et se reconnecter

1. Clique **"Déconnexion"** → retour à `/login`
2. Re-connecte-toi avec l'email/password créés
3. Tu vois la topbar **sans le lien "Équipe"** (rôle Membre)

### f. Tester le retour Admin

1. Déconnecte-toi
2. Reconnecte-toi en tant qu'Admin
3. Va sur `/team` → tu vois maintenant 2 membres
4. Clique sur "Retirer" sur le second → il disparaît de la liste
5. Tu **ne peux pas** te retirer toi-même (bouton désactivé)

### g. Tester les protections

Cas qui doivent échouer proprement :

| Scénario                                         | Résultat attendu                                           |
| ------------------------------------------------ | ---------------------------------------------------------- |
| Inviter un email déjà membre                     | "Cette personne est déjà membre de l'espace."              |
| Recharger un lien `/signup/<token>` déjà accepté | Page "Lien déjà utilisé"                                   |
| Modifier un token dans l'URL `/signup/<garbage>` | Page "Lien invalide"                                       |
| (Avec un seul Admin) Te dégrader en Member       | "Impossible : ce membre est le dernier Admin de l'espace." |
| (Avec un seul Admin) Te retirer toi-même         | Bouton désactivé côté UI + serveur refuse                  |

## 6. Vérifier l'audit log

Sur le dashboard Supabase :

1. Project → **Table Editor** → table **`audit_log`**
2. Tu dois voir :
   - `login_success` (à chaque connexion)
   - `invitation_created` (à chaque invitation)
   - `invitation_accepted` (à chaque acceptation)
   - `member_removed` (à chaque retrait)
   - `member_role_changed` (à chaque promotion/dégradation)

Aucune entrée ne doit contenir de PII (pas de mot de passe, pas de token clair, pas de body d'email).

---

## Troubleshooting

### "Failed to fetch user" sur la page

- Vérifie que `.env.local` est bien complet
- Redémarre le dev server (les vars d'env ne sont lues qu'au boot)

### "INVITATION_SECRET" manquant

Génère une clé HMAC :

```bash
openssl rand -hex 32
```

Et colle-la dans `INVITATION_SECRET=` de ton `.env.local`. Redémarre.

### Le bootstrap admin échoue avec "Workspace not found"

Lance d'abord `pnpm --filter @nexushub/db db:seed` pour créer le workspace `studio-atlas`.

### Rate limit déclenché trop rapidement en dev

Le fallback in-memory persiste tant que le dev server tourne. Redémarre `pnpm dev` pour reset les compteurs.

---

**Tu peux maintenant inviter, accepter, retirer, promouvoir / dégrader des membres. C'est exactement le flow PRD §4 parcours 1 — sans encore avoir l'UI complète.**
