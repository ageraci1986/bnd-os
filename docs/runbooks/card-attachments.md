# Runbook — Pièces jointes de cartes (lot C)

> **But** : provisionner et exploiter les pièces jointes du modal de carte
> Kanban — upload direct navigateur → Supabase Storage, scan asynchrone
> (Inngest + ClamAV), consultation par URL signée courte.
>
> **Quand l'utiliser** : mise en production du lot C, nouvel environnement
> (staging, reprise après sinistre), PJ bloquée « Analyse en cours… », pic de
> `scan_failed`, incident ClamAV.
>
> **Références** : spec `docs/superpowers/specs/2026-10-03-card-attachments-design.md`,
> plan `docs/superpowers/plans/2026-10-03-card-attachments.md`, CLAUDE.md
> §4.5.4 (PJ : upload direct + scan asynchrone, jamais servies avant `clean`),
> §4.7 (audit sans PII). Daemon ClamAV partagé avec les PJ mail :
> [`mail-attachments.md`](./mail-attachments.md) §2 et §7.

---

## 1. Flux (rappel)

1. `requestCardAttachmentUpload` (Server Action) : rôle ≠ Viewer, carte
   accessible (workspace + scope projet), rate limit `card_attachment_upload`,
   liste blanche extension + MIME, ≤ 50 Mo, ≤ 50 PJ visibles par carte →
   **crée la ligne `pending` puis** signe un jeton d'upload
   (`createSignedUploadUrl`, chemin imposé `<workspaceId>/<cardId>/<attachmentId>`).
   Si la signature échoue, la ligne est supprimée.
2. Le navigateur `PUT` le fichier directement vers Storage (jamais via nos
   fonctions — limite de corps Vercel), en multipart re-typé avec le MIME
   validé, `x-upsert: false`.
3. `finalizeCardAttachment` : rate limit `card_attachment_finalize`, auteur +
   `pending` + carte toujours accessible → événement Inngest
   `card-attachment/uploaded` avec `id: card-attachment-uploaded:<id>`
   (dédup Inngest 24 h).
4. `scan-card-attachment` (Inngest, retries 2, concurrence 5) : métadonnées
   Storage (`info`) — taille stockée = déclarée et ≤ 50 Mo, MIME stocké =
   déclaré — **avant** tout téléchargement → téléchargement (taille
   re-vérifiée) → magic bytes (`file-type`) → ClamAV. Verdict `clean` → ligne
   `clean` + sha256. Sinon : bascule **conditionnelle** `pending` → `dirty` /
   `scan_failed` d'abord (no-op si la ligne n'est plus `pending`), puis
   suppression de l'objet + audit `card_attachment_rejected`.
5. Lecture : `getCardAttachmentUrl` (rate limit `card_attachment_download`)
   et `getCardAttachmentThumbUrls` (lot de vignettes, `card_attachment_thumbs`)
   ne signent **que** des PJ `clean`, URL de 300 s. Les types non
   prévisualisables (txt, csv, Office, zip, HEIC) sont toujours signés en
   `Content-Disposition: attachment`.
6. `card-attachments-cleanup` (cron `15 * * * *`) : `pending` > 2 h 15 (>
   validité 2 h du jeton d'upload storage-js, sinon objet orphelin) et
   `dirty`/`scan_failed` > 7 j → ligne puis objet supprimés.

Jeton d'upload signé : valide **2 h** (non configurable dans storage-js
2.104.1) et **réutilisable** pendant ces 2 h tant qu'aucun objet n'existe au
chemin ; `upsert: false` interdit l'écrasement (un seul objet par chemin).

---

## 2. Migration Prisma (manuelle — ⚠ jamais `migrate deploy`)

Vercel n'applique pas les migrations. Le registre `_prisma_migrations` de la
base Supabase partagée **a dérivé** de `prisma/migrations/` : un
`prisma migrate deploy` tenterait de rejouer d'autres migrations. On exécute
donc **uniquement** le SQL de cette migration puis on la marque appliquée.
À faire **avant** le merge / déploiement.

```bash
# Depuis la racine du repo, DATABASE_URL + DIRECT_URL de l'environnement cible
# dans l'environnement du shell (jamais en clair dans l'historique/les logs).
cd packages/db
pnpm exec prisma db execute \
  --file prisma/migrations/20261003150000_card_attachments/migration.sql \
  --schema prisma/schema.prisma
pnpm exec prisma migrate resolve --applied 20261003150000_card_attachments \
  --schema prisma/schema.prisma
```

Contenu : valeurs `AuditAction` `card_attachment_rejected` /
`card_attachment_deleted`, table `card_attachments` (CHECK
`0 < size_bytes <= 52428800`, `storage_path` unique, index
`(workspace_id, card_id)` et `(scan_status, created_at)`), **RLS** activée
avec la policy `card_attachments_member_all`
(`workspace_id IN (SELECT public.workspace_ids_for_current_user())`).

### Post-check

```sql
SELECT to_regclass('public.card_attachments');            -- non NULL
SELECT relrowsecurity FROM pg_class WHERE relname = 'card_attachments'; -- true
SELECT policyname FROM pg_policies WHERE tablename = 'card_attachments';
-- Attendu : card_attachments_member_all
SELECT v FROM unnest(enum_range(NULL::"AuditAction")) AS v
WHERE v::text LIKE 'card_attachment_%';
-- Attendu : card_attachment_rejected, card_attachment_deleted
SELECT migration_name, finished_at FROM _prisma_migrations
WHERE migration_name = '20261003150000_card_attachments';  -- 1 ligne
```

---

## 3. Bucket Storage `card-attachments`

Privé, 50 Mo, MIME = **exactement** la liste blanche du domaine
(`ALLOWED_CARD_ATTACHMENT_TYPES`, `packages/domain/src/attachments/index.ts`).
Toute modification de la liste blanche doit être répercutée ici.

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('card-attachments', 'card-attachments', false, 52428800, ARRAY[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/zip'
]);
```

**Aucune policy `storage.objects`** pour `anon` / `authenticated` sur ce
bucket : ni lecture ni écriture directe. Tout passe par le service role côté
serveur (signature d'upload, `info`, download du scan, suppression) ou par
une URL signée (upload à chemin imposé, lecture 300 s d'une PJ `clean`).

Alias de détection (décision lot C) : `image/heif` → `image/heic` et
`video/x-m4v` → `video/mp4` sont acceptés **uniquement** côté contrôle magic
bytes (`isSniffCompatible`, sens unique). Ils ne sont **pas** ajoutés au
bucket : le client re-type toujours la partie multipart avec le MIME déclaré
de la liste blanche, donc Storage ne voit jamais `image/heif` ni
`video/x-m4v`. HEIC est traité comme un fichier (pas de vignette ni
d'aperçu : la plupart des navigateurs ne l'affichent pas) et toujours servi
en téléchargement.

### Post-check

```sql
SELECT id, public, file_size_limit, array_length(allowed_mime_types, 1)
FROM storage.buckets WHERE id = 'card-attachments';
-- Attendu : card-attachments | false | 52428800 | 15

SELECT policyname FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (qual ILIKE '%card-attachments%' OR with_check ILIKE '%card-attachments%');
-- Attendu : 0 ligne
```

---

## 4. ClamAV (Fly) — flux jusqu'à 50 Mo

Le daemon est celui des PJ mail (`CLAMAV_HOST` / `CLAMAV_PORT`, voir
`mail-attachments.md` §2). Le scan envoie le fichier entier en INSTREAM : si
la limite de flux clamd est inférieure à 50 Mo, clamd coupe la connexion
(« INSTREAM size limit exceeded ») → `scan_failed` sur les gros fichiers.

1. Imposer dans `clamd.conf` (l'image `clamav/clamav` ne mappe pas ces
   directives sur des variables d'environnement : monter un `clamd.conf`
   via `[[files]]` dans `fly.toml`, ou une image dérivée qui l'écrase) :

   ```conf
   StreamMaxLength 50M
   MaxScanSize 100M
   MaxFileSize 50M
   ```

   `MaxScanSize` / `MaxFileSize` **≥ 50M** : en dessous, clamd n'analyse
   que le début du fichier (verdict `OK` partiel).

2. Redéployer : `fly deploy -a nexushub-clamav`.
3. Vérifier les valeurs effectives :

   ```bash
   fly ssh console -a nexushub-clamav -C "clamconf" | grep -E "StreamMaxLength|MaxScanSize|MaxFileSize"
   ```

4. **RAM** : clamd charge la base de signatures (~1–1,5 Go) et bufferise le
   flux en cours ; avec la concurrence Inngest de 5 scans × 50 Mo, viser
   **≥ 2 Go** (`fly scale memory 2048 -a nexushub-clamav`). Surveiller
   `fly status` / métriques mémoire après le premier pic d'uploads ; un OOM
   se traduit par des `scan_failed` en rafale.
5. Le client `clamscan` a un timeout de connexion de 15 s par défaut
   (`packages/integrations/src/antivirus/clamav.ts`) : vérifier lors du test
   « vidéo 40 Mo » (§7) qu'un gros fichier passe bien `clean`.

Verdict : seul `isInfected === false` est `clean` ; `true` sans signature,
`null`/`undefined` (réponse illisible) ou exception → `scan_failed`
(fail-closed). `CLAMAV_HOST` absent → `scan_failed` systématique.

---

## 5. Inngest — resynchronisation après déploiement

Deux nouvelles fonctions : `scan-card-attachment` (événement
`card-attachment/uploaded`) et `card-attachments-cleanup` (cron horaire).

1. Après le déploiement Vercel, **Inngest dashboard → Apps → nexushub →
   Resync** (ou `PUT https://<domaine>/api/inngest`).
2. Vérifier que les deux fonctions apparaissent, et que le cron est planifié.
3. La route `/api/inngest` déclare `maxDuration = 300` : le pas `scan`
   télécharge jusqu'à 50 Mo et attend ClamAV. Vérifier que le plan Vercel
   autorise 300 s (Pro ; plafonné à 60 s sur Hobby — un scan coupé est
   rejoué par Inngest, puis finit `pending` et nettoyé à 2 h 15).

---

## 6. Rate limits (par utilisateur, Upstash)

| Clé                        | Limite  | Consommée par                                  |
| -------------------------- | ------- | ---------------------------------------------- |
| `card_attachment_upload`   | 60 / h  | `requestCardAttachmentUpload`                  |
| `card_attachment_finalize` | 60 / h  | `finalizeCardAttachment` (clé dédiée)          |
| `card_attachment_download` | 300 / h | `getCardAttachmentUrl` (visionneuse, download) |
| `card_attachment_thumbs`   | 600 / h | `getCardAttachmentThumbUrls` (1 appel / carte) |

Upstash injoignable → fail-open (anti-abus, pas une barrière de sécurité :
l'accès reste vérifié par session + scope).

---

## 7. Tests manuels (checklist de mise en production)

- [ ] Image PNG/JPEG : upload → « Analyse en cours… » → vignette, visionneuse.
- [ ] Vidéo MP4 ~40 Mo : progression, passe `clean`, lecture dans la
      visionneuse (CSP `media-src`).
- [ ] PDF : aperçu dans la visionneuse (iframe `blob:`), Échap ferme la
      visionneuse sans fermer le modal de carte.
- [ ] `.docx` / `.csv` : pas d'aperçu, le téléchargement porte le bon nom
      (Content-Disposition attachment).
- [ ] **EICAR** : fichier `eicar.txt` contenant la chaîne de test EICAR
      standard → toast « Fichier refusé par l'antivirus. », ligne `dirty`,
      objet supprimé, audit `card_attachment_rejected` avec `reason: virus`.
- [ ] `.exe` renommé en `.pdf` : toast « Type de fichier non conforme. »
      (`type_spoof`), objet supprimé.
- [ ] `.exe` sans renommage : refusé localement (aucun appel serveur).
- [ ] Fichier > 50 Mo : refusé localement.
- [ ] Viewer : peut voir/télécharger, aucune zone d'ajout ni bouton supprimer.
- [ ] Membre non-auteur : pas de bouton supprimer ; Admin : peut supprimer.
- [ ] Badge trombone sur la carte Kanban = nombre de PJ `clean`.
- [ ] ClamAV coupé (`fly scale count 0`) : nouvel upload → toast « Analyse
      impossible, réessaie plus tard. » (`scan_failed`) ; rien n'est servi.

---

## 8. Diagnostic

```sql
-- PJ bloquées en analyse (au-delà de quelques minutes = scan non déclenché
-- ou en échec ; Inngest → Runs → scan-card-attachment).
SELECT id, workspace_id, content_type, size_bytes, created_at
FROM card_attachments WHERE scan_status = 'pending'
  AND created_at < now() - interval '10 minutes' ORDER BY created_at;

-- Répartition des rejets récents par raison.
SELECT scan_status, scan_report->>'reason' AS reason, count(*)
FROM card_attachments
WHERE scan_status IN ('dirty', 'scan_failed') AND updated_at > now() - interval '24 hours'
GROUP BY 1, 2;
```

- Beaucoup de `scanner_error` → ClamAV injoignable / OOM (§4,
  `mail-attachments.md` §7).
- `missing_object` → finalize appelé sans objet (upload interrompu) ou
  objet supprimé.
- `missing_metadata` → réponse `info` Storage sans taille/MIME : vérifier
  la version de storage-api ; fail-closed volontaire.
- `size_mismatch` / `type_mismatch` → client modifié ou upload hors
  application (jeton détourné) : regarder l'audit `card_attachment_rejected`.

Les noms de fichiers ne sont jamais loggés ni audités, sauf l'exception
d'investigation `reason: virus` (comme les PJ mail).

---

## 9. Rollback

- Code : revert du merge ; les lignes existantes restent inertes.
- Données : `DROP TABLE card_attachments;` (les valeurs d'enum
  `AuditAction` ajoutées ne peuvent pas être retirées — sans impact),
  vider puis supprimer le bucket depuis le dashboard Storage, et
  `DELETE FROM _prisma_migrations WHERE migration_name = '20261003150000_card_attachments';`.
