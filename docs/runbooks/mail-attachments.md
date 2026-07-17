# Runbook — Pièces jointes mail (réception + envoi + Forward reprise)

> **See also:** [`mail-send.md`](./mail-send.md) pour l'envoi de mail (Reply /
> Reply-All / Forward / Nouveau), [`microsoft-graph-integration.md`](./microsoft-graph-integration.md)
> et [`imap-integration.md`](./imap-integration.md) pour la lecture/connexion
> des boîtes. Ce runbook couvre uniquement les **pièces jointes** (V1.5), qui
> se greffent sur ces trois flux existants.
>
> **But** : upload/download de fichiers dans `/communications` (compose +
> reader), scan antivirus synchrone, cache Supabase Storage.
>
> **Quand l'utiliser** : pour diagnostiquer un upload/download en échec,
> ré-appliquer le bucket + les migrations sur un nouvel environnement,
> déployer ou dépanner le daemon ClamAV, ou comprendre les rate limits et le
> monitoring de croissance du Storage.
>
> **Références** : `docs/superpowers/specs/2026-07-16-mail-attachments-design.md`,
> `docs/superpowers/plans/2026-07-16-mail-attachments.md`, CLAUDE.md §4.5.4
> (scan antivirus + content-type + nom de fichier sanitisé), §4.7 (audit log
> PII-safe).

---

## 1. But

Trois flux, un seul modèle de sécurité (extension blacklist → magic-byte sniff
→ scan antivirus → Storage) :

- **Réception** — pièces jointes découvertes au moment du sync (parse
  `BODYSTRUCTURE` IMAP / `/messages/{id}/attachments` Graph). Seule la
  **métadonnée** est persistée au sync ; le binaire est **lazy-fetché** à la
  demande de téléchargement (`fetchAttachmentBinary`,
  `apps/web/features/communications/actions/fetch-attachment.ts`), scanné,
  puis mis en cache dans Storage.
- **Envoi** — drag & drop ou file-picker dans le `ComposePanel`
  (`AttachmentDrop` + `useAttachmentUploader`). Upload immédiat via
  `uploadAttachment` (`apps/web/features/communications/actions/upload-attachment.ts`),
  batch multi-fichiers en parallèle (`Promise.allSettled`).
- **Forward reprise** — les pièces jointes du mail d'origine sont
  automatiquement reproposées en pièces jointes du brouillon Forward
  (`loadForwardAttachments`), sans re-upload manuel.

Toutes deux passent par un scan antivirus **synchrone et bloquant** avant tout
stockage définitif : rien n'atterrit dans le bucket Storage tant que le
verdict n'est pas `clean`.

---

## 2. ⚠ Pivot antivirus : VirusTotal → ClamAV self-hosted

Le plan initial (Task 5/12/14) ciblait l'API VirusTotal. **Décision prise en
cours d'itération par l'utilisateur** : VirusTotal est écarté à cause d'une
clause de leurs CGU pour le tier gratuit — _"must not be used in commercial
products or services"_. Incompatible avec NexusHub (produit commercial).

**Remplacement : daemon ClamAV self-hosted**, scanné via TCP INSTREAM
(`packages/integrations/src/antivirus/clamav.ts`, lib `clamscan` en mode
`clamdscan` uniquement — **jamais** de fallback vers un binaire local shell-out,
`localFallback: false` codé en dur).

Contrat de `scanFileWithClamAV` :

| Verdict       | Condition                           | Comportement appelant                                                                |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `clean`       | `isInfected=false`                  | Upload vers Storage autorisé                                                         |
| `dirty`       | `isInfected=true`                   | Rejet, `code: 'DIRTY'`                                                               |
| `scan_failed` | Connexion/scan a levé une exception | Rejet, `code: 'SCAN_FAILED'` — **traité comme dirty**, jamais silencieusement ignoré |

**Aucun contenu binaire n'est jamais loggé.** `analysisId` est un préfixe de
hash SHA-256 synthétique (`clamav-<sha16>-<timestamp>`), safe à logger.

### 2.1 Déploiement ClamAV — Fly.io

Image officielle `clamav/clamav` (inclut `freshclam` en cron intégré pour
l'auto-update des signatures — pas de job séparé à gérer).

```toml
# fly.toml (fragment) — app dédiée, ex. nexushub-clamav
app = "nexushub-clamav"
primary_region = "cdg"

[build]
  image = "clamav/clamav:latest"

[[mounts]]
  source = "clamav_data"
  destination = "/var/lib/clamav"

[[services]]
  internal_port = 3310
  protocol = "tcp"
  # Réseau privé Fly (6PN) uniquement — ne PAS exposer 3310 publiquement.
  # Vercel atteint ce host via Fly private networking (WireGuard) ou un
  # tunnel dédié ; voir §2.3 pour le détail connectivité Vercel → Fly.
  [[services.ports]]
    port = 3310
    handlers = []

[checks]
  [checks.clamd]
    type = "tcp"
    port = 3310
    interval = "30s"
    timeout = "5s"
```

Volume persistant (`clamav_data` → `/var/lib/clamav`) : conserve la base de
signatures entre redéploiements, évite un `freshclam` complet à froid à
chaque restart (les updates sont delta après le premier pull).

```bash
fly volumes create clamav_data --region cdg --size 2
fly deploy
```

### 2.2 Health check

```bash
# Depuis une machine sur le même réseau privé Fly (ou via `fly ssh console`) :
nc -z <clamav-internal-host> 3310 && echo "clamd reachable"

# Vérifie la version + que freshclam a bien tourné récemment :
fly ssh console -a nexushub-clamav -C "clamdscan --version"
fly ssh console -a nexushub-clamav -C "cat /var/log/clamav/freshclam.log | tail -20"
```

### 2.3 Connectivité Vercel → Fly (réseau privé recommandé)

- **Recommandé** : réseau privé Fly (6PN/WireGuard) — pas d'exposition
  publique du port 3310. Nécessite soit un tunnel WireGuard depuis les
  fonctions Vercel (complexe en serverless), soit un relais.
- **Fallback pragmatique retenu pour V1.5** : exposition publique du port
  3310 avec **allowlist IP** au niveau Fly (`fly.toml` proxy rules ou
  firewall Fly) restreinte aux ranges IP sortants de Vercel. À défaut
  d'allowlist fiable (IP Vercel dynamiques), documenter le risque résiduel et
  prévoir la bascule vers un vrai tunnel privé en suivi V2 si le trafic
  justifie l'investissement.
- Le protocole INSTREAM de clamd ne fait aucune authentification applicative
  — la seule barrière est réseau. Ne jamais rendre 3310 accessible sans
  restriction.

### 2.4 Env vars à ajouter sur Vercel (Preview + Production)

| Var           | Valeur                                         | Notes                                                                   |
| ------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `CLAMAV_HOST` | Hostname interne Fly (ou public si allowlisté) | Lu via `getServerEnv()`, jamais `process.env` brut (convention projet). |
| `CLAMAV_PORT` | `3310`                                         | Valeur par défaut si absent (`z.coerce.number().default(3310)`).        |

**Aucune clé VirusTotal n'est nécessaire** — `VIRUSTOTAL_API_KEY` n'a jamais
été ajoutée en env (le pivot a eu lieu avant tout déploiement de clé).

Déjà présent dans `.env.example` :

```
# packages/integrations/src/antivirus/clamav.ts. When CLAMAV_HOST is unset,
# uploadAttachment / fetchAttachmentBinary fail closed (SCAN_FAILED).
CLAMAV_HOST=
CLAMAV_PORT=3310
```

**Comportement si `CLAMAV_HOST` est absent** : fail-closed. `uploadAttachment`
et `fetchAttachmentBinary` retournent `SCAN_FAILED` immédiatement — jamais de
skip silencieux du scan.

---

## 3. Storage bucket + RLS (déjà appliqué)

Bucket `mail-attachments` créé le **2026-07-16** (Task 3) sur le projet
Supabase partagé `yphedrhofupththvlvoa`, **avant** l'application de la
migration Prisma. À rejouer tel quel pour provisionner un environnement neuf
(staging isolé, disaster recovery) :

```sql
-- 1. Bucket privé (jamais public — accès uniquement via signed URL, TTL 300s)
INSERT INTO storage.buckets (id, name, public)
VALUES ('mail-attachments', 'mail-attachments', false);

-- 2. RLS — lecture scopée par workspace_id (premier segment du path objet)
CREATE POLICY "mail_attachments_select_own_workspace"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'mail-attachments'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'workspace_id')
  );

-- 3. RLS — écriture (INSERT/UPDATE/DELETE) réservée au service role
--    (les Server Actions utilisent toujours la clé admin, jamais le JWT user)
CREATE POLICY "mail_attachments_write_service_role_only"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'mail-attachments'
    AND (auth.jwt() ->> 'role') = 'service_role'
  );
```

Path objet : `<workspaceId>/<attachmentId>` (voir
`apps/web/lib/mail-attachment-storage.ts`). Signed URL TTL = 300s
(`SIGNED_URL_TTL_SECONDS`).

### Post-check (à rejouer après provisioning)

```sql
SELECT id FROM storage.buckets WHERE id = 'mail-attachments';
-- Attendu : 1 ligne

SELECT policyname FROM pg_policies
WHERE tablename = 'objects' AND policyname LIKE 'mail_attachments_%';
-- Attendu : 2 lignes
```

### Migration Prisma

`20260716201000_mail_attachments` — table `email_attachments`
(`AttachmentScanStatus` enum : `pending` / `clean` / `dirty` / `scan_failed`),

- `email_messages.has_attachments` (dénormalisé, badge 📎 dans `MailList`)
- `mail_drafts.compose_attachments` (JSON, pièces jointes en cours de
  composition). Additive, sans backfill. Appliquée le 2026-07-16 sur la
  Supabase partagée.

---

## 4. Diagnostic — échecs upload / download

| Code              | Contexte          | Cause probable                                                                        | Action                                                                                                            |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT`      | Upload + Download | Dépassement §5                                                                        | Voir §5, ajuster si légitime (charge agence en pic).                                                              |
| `TOO_LARGE`       | Upload            | Fichier > 25 MB                                                                       | Attendu — cap dur, pas de contournement.                                                                          |
| `BLACKLISTED_EXT` | Upload            | Extension dans la blacklist (`exe msi bat cmd com scr js jar vbs ps1 app dmg sh dll`) | Attendu — l'utilisateur doit renommer/zipper si le fichier est légitime.                                          |
| `TYPE_SPOOF`      | Upload + Download | Magic-byte sniffé (`file-type`) ≠ content-type déclaré                                | Fichier probablement malveillant ou mal étiqueté — pas de bypass.                                                 |
| `DIRTY`           | Upload + Download | ClamAV a détecté une signature virale (`scan.verdict === 'dirty'`)                    | Fichier rejeté, `attachment_scanned_dirty` audité. Pas de bypass.                                                 |
| `SCAN_FAILED`     | Upload + Download | Daemon ClamAV injoignable, timeout, ou `CLAMAV_HOST` absent                           | **Incident** — voir §7. Toute la fonctionnalité fail-closed tant que non résolu.                                  |
| `UPLOAD_FAILED`   | Upload            | Erreur Supabase Storage côté service role                                             | Vérifier quota Storage / logs Supabase. Message brut jamais bubblé au client.                                     |
| `FETCH_FAILED`    | Download          | Erreur IMAP/Graph au fetch source, mismatch de taille, ou échec de signature Storage  | Voir logs serveur ; le message IMAP/Graph est surfacé (pas de secret dedans), le message Storage ne l'est jamais. |
| `NOT_FOUND`       | Download          | `attachmentId` inconnu OU appartient à un autre workspace/owner mailbox               | Double ownership check (§6) — ne JAMAIS relâcher cette contrainte.                                                |
| `INVALID_INPUT`   | Upload            | Fichier manquant, filename/content-type invalide après sanitize                       | Erreur client, pas d'action serveur.                                                                              |

---

## 5. Rate limits

Définis dans `apps/web/lib/rate-limit/index.ts` :

- **`mail_attachment_upload`** — 30 / utilisateur / heure
- **`mail_attachment_download`** — 100 / utilisateur / heure (inclut les
  lazy-fetch de pièces jointes reçues, y compris les hits de cache déjà
  `clean`)

Pour ajuster : modifier `RATE_LIMITS.mail_attachment_upload` /
`.mail_attachment_download` dans `apps/web/lib/rate-limit/index.ts`
(`{ limit, window }`, syntaxe Upstash `'1 h'`). Les tests
(`apps/web/lib/rate-limit/*.test.ts`) encodent ces valeurs en dur — les
mettre à jour en même temps.

---

## 6. Sécurité — récap

Voir `docs/superpowers/specs/2026-07-16-mail-attachments-design.md` §7/§9
pour le détail complet. Points clés :

- **Ordre des checks** (le moins cher en premier, pour ne pas gaspiller de
  cycles ClamAV) : rate limit → taille → extension blacklist → dedup SHA-256
  → magic-byte sniff → scan ClamAV → upload Storage.
- **Dedup SHA-256** — un binaire déjà scanné `clean` dans le workspace est
  réutilisé (clone du `storagePath`) sans re-scan. Scope **toujours**
  `workspaceId` — jamais de dedup cross-workspace.
- **Double ownership check au download** — `workspaceId` **ET**
  `emailMessage.integration.ownerUserId === ctx.userId`. Les intégrations
  mail sont déléguées par utilisateur (PRD §10 hypothèse #8) : un membre du
  workspace ne doit jamais pouvoir tirer une pièce jointe de la boîte d'un
  autre membre, même dans le même workspace.
- **Filename sanitizing** — contrôle de caractères, null bytes, séparateurs
  de chemin (`/ \`) strippés avant toute utilisation (`sanitizeFilename`).
  Défense en profondeur avec un second passage Zod sur les champs dérivés.
- **Audit log PII-safe** (CLAUDE.md §4.7) : `attachment_uploaded` /
  `attachment_downloaded` ne logguent **jamais** le filename. Exception
  documentée : `attachment_scanned_dirty` logge le filename
  (investigation-only, explicitement listé au spec §9).
- **Erreurs Storage jamais bubblées** au client (peuvent contenir des
  détails infra/bucket) — toujours un message générique côté `UPLOAD_FAILED`
  / `FETCH_FAILED`.
- **Cap Graph 3 MB** — l'API `sendMail` Graph limite les pièces jointes
  inline à 3 MB par fichier ; documenté dans le send orchestrator, pas de
  upload session large-file en V1.5 (suivi V2 si besoin).

---

## 7. Réponse à incident — ClamAV daemon down

**Symptômes** : tous les uploads retournent `SCAN_FAILED` ; tous les
téléchargements de pièces jointes reçues non encore cachées (`storagePath`
null ou `scanStatus` non-`clean`) retournent aussi `SCAN_FAILED`. Les
pièces jointes déjà `clean` + cachées en Storage restent téléchargeables
(pas de re-scan sur le chemin cache-hit, §4 ligne 137-149 de
`fetch-attachment.ts`).

**Impact utilisateur** : personne ne peut envoyer de nouvelle pièce jointe ;
personne ne peut télécharger une pièce jointe reçue **pas encore ouverte au
moins une fois** dans NexusHub. Les mails eux-mêmes (corps, métadonnées)
continuent de fonctionner normalement — seul le sous-système pièces jointes
est affecté.

**Pas de bypass** — le plan et le code ne prévoient **aucun flag
d'environnement pour contourner le scan**. `SCAN_FAILED` est
intentionnellement traité comme équivalent à `dirty` par tous les appelants
(§2 ci-dessus). Restaurer ClamAV est la seule voie de sortie — ne jamais
ajouter un bypass en urgence sans revue de sécurité (CLAUDE.md §4.5.4 est
non-négociable).

**Procédure** :

1. Vérifier le statut Fly : `fly status -a nexushub-clamav`.
2. Vérifier les logs : `fly logs -a nexushub-clamav`.
3. Causes fréquentes :
   - Volume `clamav_data` plein (base de signatures a grossi) → `fly volumes extend`.
   - Machine Fly suspendue/scale-to-zero → `fly machine start` ou ajuster
     `min_machines_running` dans `fly.toml`.
   - `freshclam` en échec (réseau sortant bloqué) → vérifier
     `/var/log/clamav/freshclam.log` via `fly ssh console`.
4. Health check manuel : `nc -z <clamav-host> 3310` ou
   `fly ssh console -C "clamdscan --version"`.
5. Une fois le daemon de nouveau up, aucune action DB n'est nécessaire — les
   prochains upload/download retentent normalement (pas de queue à rejouer,
   le scan est synchrone à la demande).
6. Si l'indisponibilité dépasse quelques minutes en heures ouvrées, prévenir
   les utilisateurs actifs (les erreurs `SCAN_FAILED` remontent déjà un
   message clair côté UI : « Antivirus non configuré. » / « Fichier rejeté
   par l'antivirus. » — envisager un bandeau applicatif si l'incident dure).

---

## 8. Storage growth monitoring

À exécuter mensuellement (ou avant toute discussion de quota) pour suivre la
consommation Storage par workspace :

```sql
-- Vue métier (recommandée) : basée sur email_attachments, exclut les scans
-- 'dirty'/'scan_failed' (jamais uploadés en Storage) et les métadonnées non
-- encore lazy-fetchées (storage_path NULL).
SELECT workspace_id,
       COUNT(*)                       AS attachments,
       SUM(size_bytes)                AS bytes,
       ROUND(SUM(size_bytes) / 1024.0 / 1024.0, 1) AS mb
FROM email_attachments
WHERE scan_status = 'clean' AND storage_path IS NOT NULL
GROUP BY workspace_id
ORDER BY bytes DESC;
```

```sql
-- Vue infra (cross-check direct sur storage.objects, si accès admin) :
SELECT bucket_id,
       SUM((metadata->>'size')::bigint) / 1024 / 1024 AS mb
FROM storage.objects
WHERE bucket_id = 'mail-attachments'
GROUP BY 1;
```

**Seuil d'alerte informel** : si le plus gros workspace dépasse **1 GB**,
c'est le signal de déclenchement pour prioriser le suivi V2 ci-dessous.

### ⚠ V2 follow-up — quota par workspace (PAS implémenté en V1.5)

**Explicitement demandé par l'utilisateur pour ne pas être oublié.** Aucune
limite de quota de stockage par workspace n'existe en V1.5 — un workspace
peut accumuler des pièces jointes sans plafond autre que les caps par
fichier/mail (25 MB/fichier, cap Graph 3 MB à l'envoi). Prévu pour V2 :

- Colonne `Workspace.storageQuotaBytes` (nullable = illimité par défaut).
- Enforcement à l'upload dans `uploadAttachment` / `fetchAttachmentBinary`
  (nouveau code d'erreur, ex. `QUOTA_EXCEEDED`).
- Référence : `progress.md` (Communications V1.5), suivi mémoire
  `project_phase_c_followups` (feedback/follow-ups différés côté agent).

Ne pas fermer ce point tant que `Workspace.storageQuotaBytes` n'est pas
livré — le re-surfacer à chaque revue de capacité Storage.

---

## 9. Rollback

```sql
-- Désactive un batch de pièces jointes identifiées comme dangereuses après
-- coup (ex. faux négatif ClamAV découvert a posteriori) : force le
-- re-téléchargement à retomber en échec DIRTY et invalide le cache Storage.
-- Ne supprime PAS le binaire en Storage (delete manuel séparé si besoin,
-- via deleteMailAttachment ou console Supabase).
UPDATE email_attachments
SET scan_status = 'dirty', storage_path = NULL
WHERE id IN (<liste d'ids>);
```

Rollback complet du schéma : down-migration standard Prisma si nécessaire
(pas de migration destructive prévue en V1.5 — la table est purement
additive).

---

## 10. See also

- [`mail-send.md`](./mail-send.md) — envoi de mail (Reply/Reply-All/Forward/Nouveau), réutilisé par le flow d'envoi de pièces jointes.
- [`microsoft-graph-integration.md`](./microsoft-graph-integration.md) — connexion OAuth Graph, cap 3 MB par pièce jointe côté `sendMail`.
- [`imap-integration.md`](./imap-integration.md) — connexion IMAP générique + autodiscover.
- `docs/superpowers/specs/2026-07-16-mail-attachments-design.md` — spec de design complète (V1.5).
- `docs/superpowers/plans/2026-07-16-mail-attachments.md` — plan d'implémentation (23 tâches).
