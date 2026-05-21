# Runbook — Pooler DB Supabase : vitesse vs scalabilité

> **But** : choisir le bon mode de connexion Postgres (Supavisor) selon
> l'échelle, et savoir **quand** basculer. Le mauvais choix donne soit de la
> latence inutile, soit une saturation des connexions en prod.
>
> **Quand l'utiliser** : avant de changer `DATABASE_URL` (local ou Vercel),
> ou quand la base approche de son plafond de connexions.
>
> **Références** : [`supabase-setup.md`](./supabase-setup.md),
> [`vercel-deployment.md`](./vercel-deployment.md),
> [`secret-management.md`](./secret-management.md)
>
> ⚠️ **Aucun secret ici.** Le mot de passe DB ne doit JAMAIS être écrit dans
> ce fichier. Il est dans `.env.local` (local) et Vercel Encrypted Env (prod).

---

## 1. Les deux modes (host `aws-0-eu-west-1.pooler.supabase.com`)

| Mode                   | Port                      | Connexions Postgres                                   | Vitesse/requête                                            | Serverless à grande échelle   |
| ---------------------- | ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| **Session pooler**     | `5432`                    | 1 réelle **par session client**                       | rapide (prepared statements actifs)                        | ❌ sature le plafond Postgres |
| **Transaction pooler** | `6543` + `pgbouncer=true` | **multiplexées** (relâchées après chaque transaction) | plus lente si RTT élevé (`DEALLOCATE`/`BEGIN` par requête) | ✅ des milliers de clients    |

Remplace `[TON_MOT_DE_PASSE]` par le mot de passe DB (jamais commité) :

**Transaction pooler — `6543` → Vercel / prod / preview (TOUJOURS)**

```
postgresql://postgres.yphedrhofupththvlvoa:[TON_MOT_DE_PASSE]@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

**Session pooler — `5432` → DEV LOCAL UNIQUEMENT (jamais sur Vercel)**

```
postgresql://postgres.yphedrhofupththvlvoa:[TON_MOT_DE_PASSE]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?connection_limit=5
```

---

## 2. Quel mode utiliser, et quand

> 🚨 **Règle d'or : sur Vercel (serverless) → TOUJOURS `6543`, quelle que soit
> l'échelle.** Le `5432` (session pooler) est réservé au **dev local**.

- **Vercel / prod / preview (serverless) → `6543` (+ `pgbouncer=true`).**
  C'est le seul mode compatible serverless. Le `5432` casse l'app en prod :
  les fonctions réutilisent les connexions du pooler et Prisma se prend des
  conflits de prepared statements → erreurs « Invalid prisma invocation »
  (le `/login` plante et reboucle sur lui-même). Vu en prod le 2026-05-21 en
  passant à `5432` : login impossible. Retour à `6543` = réparé.

- **Dev local (un seul process long, pas de réutilisation de connexion) →
  `5432`.** Rapide (pas de désactivation des prepared statements, pas de
  surcoût `DEALLOCATE`) et sans conflit puisqu'il n'y a qu'une session.

**À grande échelle** : le `6543` tient déjà la charge serverless (connexions
multiplexées). Surveiller _Database → Connections_ dans Supabase ; si on
approche du plafond du plan, augmenter le plan Supabase plutôt que changer de
mode.

---

## 3. Rendre le `6543` rapide : co-localiser compute + DB

Le `6543` est obligatoire sur Vercel (§2), mais il peut être lent. Le surcoût
mesuré (~130 ms/requête) venait surtout de la **distance réseau
France → eu-west-1** : chaque petit aller-retour interne du pooler coûte un RTT.

Pour le rendre rapide, **co-localiser le compute avec la DB** :

1. **Vercel Pro** (le plan Hobby ignore la config de région).
2. Région des fonctions = **eu-west-1** (même région que Supabase).

En co-localisé, le RTT passe de ~40 ms à ~1 ms → le surcoût du pooler devient
négligeable. **C'est ça le levier de vitesse en prod — pas le passage en
`5432`** (qui casse le serverless, cf. §2).

---

## 4. Procédure de bascule (le jour J)

1. Passer le projet Vercel en **Pro**, fixer la région des fonctions sur
   **eu-west-1** (Project Settings → Functions Region).
2. Vercel → Project Settings → Environment Variables → `DATABASE_URL` :
   coller la forme **`6543`** (§1), pour _Production_ **et** _Preview_.
3. Re-déployer (les variables d'env ne s'appliquent qu'au prochain build).
4. Vérifier dans Supabase que le nombre de connexions reste bas et stable
   sous charge.

Retour arrière : recoller la forme `5432` et re-déployer.

---

## 5. Note `connection_limit` (action code à prévoir pour le scale)

Le code force `connection_limit=5` au runtime via `resolveDatabaseUrl()`
(`packages/db/src/index.ts`) — donc la valeur mise dans l'URL est **écrasée**.

- En `5432` (petite échelle) : `5` est OK.
- En `6543` à grande échelle : la recommandation Prisma serverless +
  transaction pooler est `connection_limit=1` (chaque fonction n'ouvre qu'une
  connexion, le pooler multiplexe le reste). **Avant de scaler, revoir
  `resolveDatabaseUrl()`** pour ne plus forcer `5` en mode transaction pooler
  (ex. : détecter `pgbouncer=true` dans l'URL et laisser `1`).

---

## 6. Optimisation applicative (utile à toute échelle)

La latence se paie **par aller-retour DB**. Indépendamment du pooler, réduire
le nombre de requêtes par action aide partout :

- Server Actions : grouper les lectures indépendantes en `Promise.all`
  (déjà fait pour la page projet et l'ouverture de modal).
- Piste restante : faire renvoyer le détail complet de la carte par
  `createCard` pour économiser le `getCardModalData` à la création.
