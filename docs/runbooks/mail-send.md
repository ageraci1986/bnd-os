# Runbook — Envoi de mail (Reply / Reply-All / Forward / Nouveau)

> **See also:** [`microsoft-graph-integration.md`](./microsoft-graph-integration.md) et
> [`imap-integration.md`](./imap-integration.md) pour la lecture/connexion des boîtes.
> Ce runbook couvre uniquement l'**envoi** (outbound), qui réutilise ces deux adapters.
>
> **But** : envoyer un mail (Reply / Reply-All / Forward / Nouveau mail) depuis
> `/communications`, via Microsoft Graph **ou** IMAP/SMTP.
>
> **Quand l'utiliser** : pour diagnostiquer un envoi en échec, ré-appliquer les
> migrations sur un nouvel environnement, ou comprendre le comportement du
> Sent folder / des rate limits.
>
> **Références** : `docs/superpowers/specs/2026-05-28-email-foundations-design.md`
> (voir §10 Sécurité pour le détail des mesures), CLAUDE.md §4.2 (tokens chiffrés),
> §4.7 (audit log PII-safe).

---

## 1. But

Le module Communications supporte l'envoi de mail en plus de la lecture
(itérations 1 et 2). Quatre modes : **Reply**, **Reply-All**, **Forward**,
**Nouveau mail**. Les deux sources de mail existantes (Microsoft Graph et
IMAP générique) ont chacune leur propre adapter d'envoi :

- **Graph** — `POST /me/sendMail` (`packages/integrations/src/graph/send.ts`)
- **IMAP/SMTP** — SMTP direct via les identifiants chiffrés de l'`Integration`
  (`apps/web/features/communications/actions/send-mail-imap.ts`), avec copie
  best-effort dans le dossier Sent via IMAP APPEND.

Le composer (`ComposePanel`) vit dans `/communications`, avec auto-save de
brouillon, injection de signature, et verrouillage du champ From côté serveur.

---

## 2. Variables d'environnement

**Aucune nouvelle variable d'environnement introduite par cette feature.**
L'envoi réutilise entièrement les variables déjà en place :

| Var                          | Purpose                                              | Source                        |
| ---------------------------- | ---------------------------------------------------- | ----------------------------- |
| `ENCRYPTION_KEY`             | Déchiffrement des tokens Graph / identifiants SMTP   | Déjà en place (Graph + IMAP)  |
| `UPSTASH_REDIS_REST_URL`     | Rate limiting de l'envoi (double fenêtre heure/jour) | Déjà en place (rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN`   | Idem                                                 | Déjà en place                 |
| Tokens OAuth Graph existants | Envoi via `sendMail`, refresh automatique si expiré  | Déjà en place (Graph)         |

---

## 3. Migrations

Deux migrations, appliquées le **2026-07-16** sur le projet Supabase partagé
(staging = prod aujourd'hui) :

### 3.1 `20260716134517_mail_send_foundations`

Ajoute (additif, sans casse) :

- Enum `MailDraftKind` (`reply` / `reply_all` / `forward` / `new_mail`)
- Enum `EmailSendStatus` (`queued` / `sending` / `sent` / `failed`)
- `integrations.signature_html` (nullable) — signature HTML par boîte mail
- `email_messages.send_status`, `email_messages.send_error`,
  `email_messages.sent_by_user_id` (FK `ON DELETE SET NULL` — la trace outbox
  survit à la suppression de l'utilisateur)
- Table `mail_drafts` — un brouillon actif par `(workspace_id, user_id)`
  (contrainte unique), FK cascade sur workspace/user/integration, FK
  `reply_to_id` en `SET NULL` si le mail d'origine est supprimé

### 3.2 `20260716140000_audit_mail_sent`

Étend l'enum `AuditAction` avec deux valeurs (`ALTER TYPE ... ADD VALUE IF NOT
EXISTS`, idempotent) :

- `mail_sent`
- `mail_send_failed`

### Post-check

```sql
-- Colonnes outbox + signature
SELECT column_name FROM information_schema.columns
WHERE (table_name = 'email_messages' AND column_name IN ('send_status','send_error','sent_by_user_id'))
   OR (table_name = 'integrations' AND column_name = 'signature_html');
-- Attendu : 4 lignes

-- Table mail_drafts + contrainte unique
SELECT indexname FROM pg_indexes WHERE tablename = 'mail_drafts';
-- Attendu : inclut mail_drafts_pkey + mail_drafts_workspace_id_user_id_key

-- Enum AuditAction étendu
SELECT unnest(enum_range(NULL::"AuditAction"));
-- Attendu : inclut 'mail_sent' et 'mail_send_failed'
```

### Statut

Les deux migrations sont appliquées sur le projet Supabase partagé (staging =
prod) le **2026-07-16**.

---

## 4. Rate limits

Double fenêtre, vérifiée dans `checkMailSendRate` (`apps/web/lib/rate-limit/index.ts`) :

- **50 mails / utilisateur / heure**
- **300 mails / utilisateur / jour**
- **20 destinataires max** au total (to + cc + bcc) par mail

La fenêtre heure est vérifiée en premier — si elle échoue, la fenêtre jour
n'est **pas** consommée (pas de double-comptage sur un échec). En cas de
dépassement, `sendMail` retourne :

```ts
{ ok: false, code: 'RATE_LIMIT', window: 'hour' | 'day', retryAfterMs: number }
```

Dépassement du cap de destinataires → `code: 'TOO_MANY_RECIPIENTS'` (validé
côté Zod avant même l'appel au rate limiter).

---

## 5. Diagnostic — send failed

Chaque code d'échec retourné par `sendMail` :

| Code                  | Cause probable                                                                                                      | Action                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_NOT_CONFIGURED` | Boîte IMAP sans SMTP configuré (host/port/TLS jamais renseignés)                                                    | L'utilisateur clique « Configurer maintenant » dans le banner du `ComposePanel`, renseigne SMTP host/port/TLS, teste, sauve. |
| `AUTH`                | Mot de passe changé côté fournisseur, ou 2FA activée sans mot de passe d'application dédié                          | Rediriger vers « Réessayer » avec le nouveau mot de passe (reconfigurer la boîte).                                           |
| `TLS`                 | Port incohérent avec le mode TLS choisi (587 = STARTTLS, 465 = TLS implicite)                                       | Vérifier/corriger la config SMTP de la boîte.                                                                                |
| `HOST`                | Faute de frappe dans le host SMTP, ou résolution DNS échouée                                                        | Vérifier le host.                                                                                                            |
| `TIMEOUT`             | Serveur SMTP lent, ou notre IP bloquée côté fournisseur                                                             | Réessayer plus tard ; si persistant, contacter le support du fournisseur mail.                                               |
| `SEND_FAILED`         | Fallback générique (Graph 4xx/5xx, erreur SMTP non catégorisée)                                                     | Voir logs serveur (`sendError` sur la ligne `EmailMessage`, jamais loggé avec le body/adresses complètes).                   |
| `MAILBOX_NOT_FOUND`   | `fromIntegrationId` ne correspond à aucune intégration active appartenant à l'utilisateur dans le workspace courant | Vérifier que la boîte est toujours connectée (`status = 'active'`) sur `/integrations`.                                      |

Pour **Graph**, un 4xx sur `sendMail` doit d'abord faire vérifier la
fraîcheur du token — `getValidAccessToken` gère le refresh automatique via le
refresh_token ; un 401 persistant après refresh signifie que la connexion
Graph doit être reconnectée (`/integrations`).

Le message d'erreur brut (`sendError`) est stocké sur la ligne
`EmailMessage` correspondante mais **jamais loggé en clair côté serveur** au
delà de cette colonne — voir §11 Sécurité.

---

## 6. Retry

Bouton manuel **« Réessayer »** affiché sur les mails avec `sendStatus =
'failed'` dans le reader Communications. Server Action `retrySendMail`
(`apps/web/features/communications/actions/retry-send-mail.ts`) :

- Recharge `subject`, `bodyHtmlSanitized`, `toRecipients`, `ccRecipients`
  depuis la ligne `EmailMessage` d'origine et relance `sendMail` en mode
  `new_mail`.
- **Limitation connue** : le BCC n'est pas persisté sur `EmailMessage` (seuls
  to/cc le sont) — un retry perd tout BCC original.
- L'auto-retry (Inngest, exponentiel backoff) est **hors scope V1**, prévu
  V1.5.

---

## 7. Sent folder handling

- **Graph** : natif via `saveToSentItems: true` sur l'appel `sendMail`
  (`packages/integrations/src/graph/send.ts`) — le mail apparaît directement
  dans le dossier Sent Items du compte Outlook/M365, aucune action NexusHub
  supplémentaire nécessaire.
- **IMAP** : `appendToSentFolder` (`packages/integrations/src/smtp/imap-append.ts`)
  fait un `LIST` puis tente un `APPEND` dans le premier nom de dossier trouvé
  parmi, dans l'ordre : `Sent Items`, `Sent`, `Sent Mail`, `INBOX.Sent`,
  `INBOX.Sent Items`. **Best-effort** : si aucun dossier ne matche, ou si le
  `LIST`/`APPEND` échoue (quota, permissions…), l'erreur est **avalée** — le
  send côté SMTP reste valide, seule la copie IMAP est manquante.
- Dans les deux cas, le `EmailMessage` local est **toujours** inséré
  (`folder: 'sent'`, `sendStatus: 'sent'`) dès que le send a réussi — visible
  immédiatement dans NexusHub, indépendamment du succès de la copie Sent
  côté serveur mail distant.

---

## 8. Drafts

- Un brouillon **actif par utilisateur par workspace** (contrainte unique
  `mail_drafts_workspace_id_user_id_key`) — pas de multi-brouillon en V1.
- Auto-save **2 secondes après idle** dans le `ComposePanel`.
- Le brouillon est **supprimé** (`prisma.mailDraft.deleteMany`) juste après
  un envoi réussi (étape 8 de `sendMail`) — un échec d'envoi **ne** supprime
  **pas** le brouillon.

---

## 9. Signatures

- Colonne `integrations.signature_html` (nullable), une signature par boîte
  mail (pas par workspace).
- Éditable dans `/settings/mailboxes`.
- Sanitizée via la même allowlist partagée
  (`packages/integrations/src/mail/sanitize.ts`) que le reste des corps de
  mail, **avant persist** en DB.
- Auto-injectée par le `ComposePanel` selon la boîte From actuellement
  sélectionnée (Reply/Reply-All/Forward pré-remplissent le From de la boîte
  qui a reçu le mail d'origine ; Nouveau mail utilise la boîte par défaut de
  l'utilisateur).

---

## 10. Rollback

Si un incident (boucle d'envoi, bug de contenu, credentials compromis) exige
d'arrêter l'envoi immédiatement :

```sql
-- Marque tous les outbox en attente comme failed : arrête l'envoi côté serveur
-- pour tout ce qui n'est pas encore parti. N'annule PAS un envoi déjà "sent".
UPDATE email_messages
SET send_status = 'failed', send_error = 'rollback'
WHERE send_status IN ('queued', 'sending');
```

Pour désactiver l'UI d'envoi en urgence (sans toucher à la DB) : retirer les
boutons Reply / Reply-All / Forward / Nouveau mail du `ComposePanel` — aucun
feature flag dédié n'existe aujourd'hui, à ajouter si le besoin se présente
en urgence (voir `apps/web/features/communications/`).

---

## 11. Sécurité

Voir `docs/superpowers/specs/2026-05-28-email-foundations-design.md` §10
pour le détail complet. Points clés :

- **From lock** — le serveur force `fromEmail = integration.externalAccountId`
  dans `sendMail` ; l'utilisateur ne peut **jamais** forger l'adresse
  d'expédition depuis le client (le champ From n'est même pas un input libre
  côté payload de l'action).
- **XSS double barrière** — le corps HTML est sanitizé côté client (Tiptap)
  **et** re-sanitizé côté serveur (`sanitizeMailHtml`, même allowlist que la
  lecture) juste avant l'envoi et avant l'insert `EmailMessage`. Ne jamais
  faire confiance au HTML reçu du client.
- **Ownership** — `fromIntegrationId` est chargé avec
  `where: { id, workspaceId, ownerUserId, kind: { in: ['graph','imap'] }, status: 'active' }` ;
  aucune requête `sendMail` ne peut cibler une intégration d'un autre
  utilisateur ou d'un autre workspace.
- **Audit events PII-safe** :
  - `mail_sent` → `{ integrationId, toDomains, subjectLen }`
  - `mail_send_failed` → `{ integrationId, code, toDomains }`
  - `toDomains` = uniquement les domaines des destinataires (dédupliqués,
    lowercased), **jamais** les adresses complètes, le sujet ou le corps.
- **Rate limiting** — voir §4 ; empêche l'exfiltration en masse ou l'usage de
  NexusHub comme relais spam via une boîte compromise.

---

## 12. See also

- [`microsoft-graph-integration.md`](./microsoft-graph-integration.md) — connexion OAuth Graph
- [`imap-integration.md`](./imap-integration.md) — connexion IMAP générique + autodiscover
- `docs/superpowers/specs/2026-05-28-email-foundations-design.md` — spec de design Communications (fondations email + envoi)
