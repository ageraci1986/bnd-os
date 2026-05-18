# Runbook — Vérifier le domaine Resend

> **But** : sortir Resend du mode test (où seul l'email propriétaire du
> compte reçoit) pour permettre les invitations et alertes vers
> n'importe quelle adresse.
>
> **Domaine cible (CLAUDE.md §2)** : `mail.nexushub.app` (sous-domaine
> dédié à l'envoi — le domaine racine `nexushub.app` reste libre pour
> autre chose).
>
> **Région Resend** : `eu-west-1` (cohérent avec Supabase staging EU).

---

## 0. Pré-requis

- [ ] Acquérir le domaine racine (`nexushub.app` ou alternative) chez
      un registrar (Gandi, OVH, Cloudflare Registrar, Vercel Domains…).
- [ ] Avoir accès à la zone DNS de ce domaine (où on ajoutera les
      enregistrements SPF / DKIM / DMARC / return-path).
- [ ] Avoir accès au dashboard Resend (compte propriétaire actuel).

> Tant que le pré-requis 1 n'est pas rempli, **rester en mode test** :
> l'application fonctionne, les invitations sont envoyées à l'email
> propriétaire du compte Resend, le reste tombe dans la console dev
> (cf. `EmailAdapter.devFallback`).

---

## 1. Créer le domaine côté Resend

Deux options équivalentes :

**A. Via le dashboard Resend** (https://resend.com/domains)

1. Clique « Add Domain »
2. Nom : `mail.nexushub.app`
3. Région : `Europe (Ireland)` / `eu-west-1`
4. TLS : `Opportunistic` (défaut)
5. Custom Return-Path : laisser `send` (défaut)
6. Resend affiche la liste des enregistrements DNS à ajouter — **copie-les**

**B. Via le MCP Resend (Claude)**

- Dis-moi « crée le domaine Resend `mail.nexushub.app` en eu-west-1 »
- J'utilise `mcp__resend__create-domain` et je te restitue la liste DNS

Tu obtiendras typiquement 4 enregistrements :

- 1 × **MX** sur `send.mail.nexushub.app` → `feedback-smtp.eu-west-1.amazonses.com` (priorité 10) — return-path
- 1 × **TXT** sur `send.mail.nexushub.app` → `v=spf1 include:amazonses.com ~all` — SPF
- 1 × **TXT** sur `resend._domainkey.mail.nexushub.app` → clé publique DKIM (longue chaîne)
- 1 × **TXT** sur `_dmarc.mail.nexushub.app` → `v=DMARC1; p=none;` — DMARC

> Le nom exact dépend de Resend ; respecte **strictement** ce qu'il
> affiche (sous-domaine + valeur).

---

## 2. Configurer la DNS

Dans ta zone DNS (Cloudflare / OVH / Gandi / Vercel DNS / autre) :

1. Crée chaque enregistrement Resend tel quel.
2. **TTL** : 300s (5 min) le temps de la vérif ; tu repasseras à 3600s
   après.
3. **Cloudflare uniquement** : mets ces enregistrements en mode
   « DNS only » (nuage gris), surtout PAS « Proxied » — Resend ne peut
   pas vérifier à travers le proxy CDN.
4. Attends la propagation : 5 à 30 minutes en général. Pour vérifier :

```bash
dig +short TXT send.mail.nexushub.app
dig +short TXT resend._domainkey.mail.nexushub.app
dig +short TXT _dmarc.mail.nexushub.app
dig +short MX  send.mail.nexushub.app
```

Si une des sorties est vide, la propagation n'est pas terminée — patience.

---

## 3. Déclencher la vérification

**A. Via le dashboard** : sur la page du domaine, clique « Verify DNS records ».

**B. Via le MCP Resend (Claude)** : dis-moi « vérifie le domaine
Resend `mail.nexushub.app` » et j'appelle `mcp__resend__verify-domain`.

Statut attendu : `verified` (peut prendre 1 à 5 minutes). Si ça reste
en `pending` ou `failed`, repasse à l'étape 2 (probablement un
enregistrement mal saisi ou un proxy DNS qui filtre).

---

## 4. Mettre à jour les variables d'env

**Local (`.env.local`)** :

```
RESEND_FROM_EMAIL=invitations@mail.nexushub.app
RESEND_FROM_NAME=NexusHub
```

**Vercel (Project Settings → Environment Variables)** pour
`Production` et `Preview` :

- `RESEND_API_KEY` → ta clé prod Resend
- `RESEND_FROM_EMAIL` → `invitations@mail.nexushub.app`
- `RESEND_FROM_NAME` → `NexusHub`

> Le code (`apps/web/lib/email/index.ts`) lit ces 3 variables au boot
> et tombe en console-fallback en dev si la clé manque. En production
> une clé manquante throw à la première utilisation.

---

## 5. Test end-to-end

1. Redémarre `pnpm dev` (le mécanisme `let _email` cache le client).
2. Connecte-toi en Admin sur `/team`.
3. Invite une adresse externe (pas la tienne).
4. Vérifie :
   - L'email arrive bien dans la boîte de l'invité (pas en spam).
   - L'expéditeur affiché est `NexusHub <invitations@mail.nexushub.app>`.
   - Le lien d'acceptation pointe vers le bon `NEXT_PUBLIC_APP_URL`.
5. Ouvre le dashboard Resend → onglet « Logs » → l'envoi doit être
   `Delivered` (pas `Queued`).

---

## 6. Rollback / dégradation

Si une régression sort des mails illégitimes ou que le domaine est
compromis :

1. Dashboard Resend → ce domaine → « Suspend sending »
2. Régénérer la clé API (« API Keys » → l'ancienne → « Delete »)
3. Pousser une nouvelle `RESEND_API_KEY` sur Vercel (déclenche un
   redeploy auto)
4. Mettre à jour ce runbook avec ce qui s'est passé

---

## 7. Documentation associée

- Décision de la stack : `CLAUDE.md` §2 (Backend & data > Resend)
- Code consommateur : `apps/web/lib/email/index.ts`, adapter dans
  `packages/integrations/email`
- Template HTML : `apps/web/features/invitations/email/templates.ts`
- Plan rotation secrets : `docs/runbooks/secret-rotation.md`
