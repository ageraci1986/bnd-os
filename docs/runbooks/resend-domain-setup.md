# Runbook — Vérifier le domaine Resend

> **But** : sortir Resend du mode test (où seul l'email propriétaire du
> compte reçoit) pour permettre les invitations et alertes vers
> n'importe quelle adresse.
>
> **Domaine sender retenu** : `brandnewday.agency` (racine), avec
> expéditeur final `app@brandnewday.agency`. Le domaine est hébergé
> chez OVH.
>
> **Région Resend** : `eu-west-1` (cohérent avec Supabase staging EU).

---

## 0. Pré-requis (déjà OK ici)

- [x] Domaine `brandnewday.agency` possédé et géré chez OVH.
- [x] Accès à la zone DNS OVH (espace client → Domaines → zone DNS).
- [x] Compte Resend actif avec accès API.

> Constat DNS au 2026-05-18 (avant intervention) : le domaine racine a
> déjà des MX OVH (`mx{0..4}.mail.ovh.net`) + une SPF
> `v=spf1 include:mx.ovh.com ~all`. **Pas besoin d'y toucher** : Resend
> publie sa SPF sur le sous-domaine `send.brandnewday.agency`
> (return-path), pas sur la racine. Ta config mail OVH existante reste
> intacte.

---

## 1. Domaine créé + vérifié côté Resend ✅ (2026-05-18)

```
Name:    brandnewday.agency
ID:      98abe860-de97-4655-8ea6-fd57768776f4
Region:  eu-west-1
TLS:     opportunistic
Custom Return-Path: send
Status:  verified ✅
Sending: enabled ✅
DKIM:    verified
SPF MX:  verified
SPF TXT: verified
```

DNS posés chez OVH le 2026-05-18 (DKIM + return-path MX + return-path
SPF + DMARC monitoring), vérifiés via `mcp__resend__verify-domain`
quelques minutes après propagation. Aucun changement sur la SPF
racine OVH (mail OVH existant intact).

---

## 2. DNS à poser chez OVH

Espace client OVH → **Domaines** → `brandnewday.agency` → onglet
**« Zone DNS »** → bouton **« Ajouter une entrée »**.

> OVH demande les valeurs TXT **sans guillemets** (il les ajoute
> lui-même). Le champ « Sous-domaine » se remplit avec le préfixe
> seul, pas le FQDN complet.

### Records obligatoires (3)

| #   | Type    | Sous-domaine        | Cible / Valeur                                                                                                                                                                                                               | TTL | Prio |
| --- | ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| 1   | **TXT** | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC5uWKxQknsOHvSiYkilRJwfNchdwkT/mwg5vIcFGXqi2bIqWg8I78MlYQljBuEzHtWThMRtVOIklzQQsZPkSyTkduQe2eNT3xfzZq7FlRSifztQkxGmWlMXeDR/teH9s/zySr5AjT1xHjJnSNzTWnuXP8XphjGXqxS6d1PjYg5LQIDAQAB` | 300 | —    |
| 2   | **MX**  | `send`              | `feedback-smtp.eu-west-1.amazonses.com.`                                                                                                                                                                                     | 300 | 10   |
| 3   | **TXT** | `send`              | `v=spf1 include:amazonses.com ~all`                                                                                                                                                                                          | 300 | —    |

### Record recommandé (DMARC, optionnel mais conseillé)

| #   | Type    | Sous-domaine | Valeur                                                   | TTL |
| --- | ------- | ------------ | -------------------------------------------------------- | --- |
| 4   | **TXT** | `_dmarc`     | `v=DMARC1; p=none; rua=mailto:ageraci.finance@gmail.com` | 300 |

> `p=none` = mode rapport uniquement, n'impacte pas la délivrabilité.
> Permet de recevoir les rapports DMARC chez l'admin. Tu pourras
> passer à `p=quarantine` puis `p=reject` après quelques semaines
> d'observation.

> ⚠️ Si tu modifies l'enregistrement TXT racine existant
> (`v=spf1 include:mx.ovh.com ~all`), **stop**. Ne le touche pas.
> Cette config Resend ne nécessite **aucun changement** sur la SPF
> racine — la SPF Resend va sur `send`, séparée.

---

## 3. Vérification de la propagation

Attends 5 à 30 minutes après création des records, puis :

```bash
dig +short TXT resend._domainkey.brandnewday.agency
# attendu : la longue chaîne commençant par "p=MIG..."

dig +short MX  send.brandnewday.agency
# attendu : "10 feedback-smtp.eu-west-1.amazonses.com."

dig +short TXT send.brandnewday.agency
# attendu : "v=spf1 include:amazonses.com ~all"

dig +short TXT _dmarc.brandnewday.agency  # si DMARC posé
# attendu : "v=DMARC1; p=none; ..."
```

Si une sortie est vide ou ancienne (cache), retente après 5 min ou
force le résolveur Google : `dig @8.8.8.8 +short TXT send.brandnewday.agency`.

---

## 4. Déclencher la vérification Resend

**Via Claude** : dis-moi « vérifie le domaine Resend `brandnewday.agency` »
et j'appelle `mcp__resend__verify-domain` (id `98abe860-de97-4655-8ea6-fd57768776f4`).

**Via dashboard** : https://resend.com/domains → `brandnewday.agency`
→ bouton « Verify DNS records ».

Statut attendu : `verified` (1 à 5 min). Si `pending` ou `failed`,
relis l'étape 2 — typiquement un copier-coller incomplet sur le DKIM
ou un préfixe « send » mal saisi.

---

## 5. Mettre à jour les variables d'env

**`.env.local`** (à la racine du repo et dans `apps/web/.env.local`) :

```
RESEND_FROM_EMAIL=app@brandnewday.agency
RESEND_FROM_NAME=NexusHub
```

**Vercel** → Project Settings → Environment Variables → `Production`
ET `Preview` :

- `RESEND_API_KEY` → clé prod (Resend → API Keys → Create)
- `RESEND_FROM_EMAIL` → `app@brandnewday.agency`
- `RESEND_FROM_NAME` → `NexusHub`

> `apps/web/lib/email/index.ts` lit ces 3 variables et cache le client
> au boot. Après changement, **redémarre `pnpm dev`**.

---

## 6. Smoke test end-to-end

1. `pnpm dev` (relance complète, pas juste un HMR)
2. Connecte-toi en Admin sur `/team`
3. Invite une adresse externe (pas la tienne)
4. Vérifie :
   - Le mail arrive (vérifier aussi le dossier spam au premier envoi)
   - Expéditeur affiché : `NexusHub <app@brandnewday.agency>`
   - Le lien d'acceptation pointe vers le bon `NEXT_PUBLIC_APP_URL`
5. Dashboard Resend → **Logs** → l'envoi doit être `Delivered`
   (pas `Queued` ni `Bounced`)

---

## 7. Rollback / dégradation

Si une régression sort des mails illégitimes ou que le domaine est
compromis :

1. Dashboard Resend → `brandnewday.agency` → « Suspend sending »
2. Régénérer la clé API (API Keys → l'ancienne → Delete)
3. Pousser une nouvelle `RESEND_API_KEY` sur Vercel (redeploy auto)
4. Mettre à jour ce runbook avec ce qui s'est passé

---

## 8. Documentation associée

- Décision de la stack : `CLAUDE.md` §2 (Backend & data > Resend)
- Code consommateur : `apps/web/lib/email/index.ts`, adapter dans
  `packages/integrations/email`
- Template HTML : `apps/web/features/invitations/email/templates.ts`
- Rotation des secrets : `docs/runbooks/secret-rotation.md`
