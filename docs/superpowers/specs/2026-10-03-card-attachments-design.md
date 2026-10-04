# Lot C — Pièces jointes dans les cartes de projet

- **Date :** 2026-10-03
- **Branche / worktree :** `feature/card-attachments` (depuis `main` @ e4cfff4) — `.worktrees/card-attachments`
- **Statut :** validé en brainstorming (Angelo L.)
- **Référence :** pattern pièces jointes mail (`docs/superpowers/specs/2026-07-16-mail-attachments-design.md`,
  `features/communications/actions/upload-attachment.ts`, `lib/mail-attachment-storage.ts`,
  `packages/integrations/src/antivirus/clamav.ts`), CLAUDE.md §4.5.4.

## Objectif

Joindre des fichiers (images, vidéos, PDF, documents) à une carte, les prévisualiser dans le modal et les
télécharger — avec scan antivirus obligatoire, sans jamais servir un fichier non vérifié.

## Contraintes qui déterminent l'architecture

1. **Limite de corps Vercel ≈ 4,5 Mo** (et 1 Mo par défaut pour une Server Action) : un fichier de 50 Mo ne
   peut pas transiter par une fonction serverless. → **Upload direct navigateur → Supabase Storage** via URL
   d'upload signée ; le serveur ne reçoit jamais le binaire depuis le client.
2. **ClamAV obligatoire** : le scan se fait **après** l'upload, dans un job Inngest qui relit l'objet depuis
   Storage. Le fichier reste en quarantaine (`pending`) tant que le verdict n'est pas `clean`.
3. **CSP stricte** (§4.6) : `media-src` et `frame-src` ne sont pas déclarés (repli sur `default-src 'self'`).
   → ajout de `media-src 'self' blob: https://<supabase-host>` et `frame-src 'self' blob:` ; les PDF sont affichés via
   une URL `blob:` (fetch du fichier signé) plutôt qu'un iframe cross-origin.

Approches écartées : Server Action avec `bodySizeLimit` relevé (bloquée par la limite Vercel) ; upload
fragmenté via Route Handler (complexité sans gain).

## 1. Données

- **Modèle Prisma `CardAttachment`** (table `card_attachments`) :
  - `id` uuid PK, `workspaceId` uuid, `cardId` uuid (FK `cards`, `onDelete: Cascade`), `uploadedById` uuid
    nullable (FK `users`, `onDelete: SetNull`) ;
  - `filename` varchar(255) (assaini), `contentType` varchar(255), `sizeBytes` int ;
  - `storagePath` varchar(512) unique (`<workspaceId>/<cardId>/<attachmentId>`) ;
  - `scanStatus` `AttachmentScanStatus` (enum existant : `pending | clean | dirty | scan_failed`), défaut
    `pending` ; `sha256` char(64) nullable (rempli au scan) ; `scanReport` Json nullable ;
  - `createdAt`, `updatedAt` ;
  - index `(workspaceId, cardId)`, `(scanStatus, createdAt)`.
- **Migration** additive + **RLS** : policy `workspace_id IN (SELECT public.workspace_ids_for_current_user())` (même
  helper que les autres tables, cf. `20260427100002_rls_helpers_and_policies`). À appliquer manuellement sur Supabase
  (registre Prisma de la base partagée en dérive : `db execute` + `migrate resolve`, jamais `migrate deploy`
  à l'aveugle).
- **Bucket** `card-attachments` : **privé**, `file_size_limit = 52428800` (50 Mo), `allowed_mime_types` =
  liste blanche ci-dessous ; policies Storage : aucun accès `anon`/`authenticated` direct en lecture — lecture
  uniquement via URL signée générée côté serveur (service role) ; l'upload passe par `createSignedUploadUrl`
  (jeton lié au chemin, valide 2 h et réutilisable tant qu'aucun objet n'existe au chemin —
  `upsert: false` — donc un seul objet possible par chemin ; chemin imposé). Création manuelle documentée dans un runbook
  `docs/runbooks/card-attachments.md` (SQL fourni).

## 2. Types autorisés (liste blanche)

| Famille   | Extensions                           | MIME                                                                                                                                                                                |
| --------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images    | jpg, jpeg, png, gif, webp, heic      | image/jpeg, image/png, image/gif, image/webp, image/heic                                                                                                                            |
| Vidéos    | mp4, mov, webm                       | video/mp4, video/quicktime, video/webm                                                                                                                                              |
| Documents | pdf, docx, xlsx, pptx, txt, csv, zip | application/pdf, application/vnd.openxmlformats-officedocument.{wordprocessingml.document, spreadsheetml.sheet, presentationml.presentation}, text/plain, text/csv, application/zip |

Règles pures dans `packages/domain/src/attachments` (100 % testées) : `CARD_ATTACHMENT_MAX_BYTES`
(50 Mo), `CARD_ATTACHMENT_MAX_PER_CARD` (50), `ALLOWED_CARD_ATTACHMENT_TYPES`, `sanitizeAttachmentFilename`,
`attachmentKind(contentType) → 'image' | 'video' | 'pdf' | 'file'`, `isAllowedAttachment(filename,
contentType)` (extension ET MIME cohérents), `isSniffCompatible(declared, sniffed)` (alias : docx/xlsx/pptx
sniffés en `application/zip`, txt/csv non sniffables → acceptés si déclarés texte).

## 3. Flux d'upload

1. **`requestCardAttachmentUpload({ cardId, filename, contentType, sizeBytes })`** (Server Action) :
   `requireUser` → Viewer refusé → carte chargée scopée workspace + accès projet (`loadUserScope`) → Zod →
   rate limit `card_attachment_upload` (60 / h / user) → `isAllowedAttachment` → taille ≤ 50 Mo → nombre de
   PJ non `dirty` de la carte < 50 → crée la ligne `pending` → `createSignedUploadUrl(storagePath)` →
   renvoie `{ attachmentId, uploadUrl/token, path }`.
2. **Navigateur** : `supabase.storage.from('card-attachments').uploadToSignedUrl(path, token, file)` avec
   barre de progression (XHR si nécessaire pour la progression). Plusieurs fichiers en parallèle (max 3).
3. **`finalizeCardAttachment({ attachmentId })`** (Server Action) : vérifie propriétaire + `pending` →
   `inngest.send('card-attachment/uploaded', { attachmentId })`.
4. **Fonction Inngest `scan-card-attachment`** (retries 2, concurrence limitée) :
   - télécharge l'objet (service role) ; objet absent → `scan_failed` ;
   - taille réelle > 50 Mo ou ≠ `sizeBytes` déclaré → rejet ;
   - sniff magic bytes (`file-type`) → `isSniffCompatible` sinon rejet (`type_spoof`) ;
   - sha256 ; ClamAV (`scanFileWithClamAV`, `CLAMAV_HOST/PORT`) ;
   - `clean` → `scanStatus=clean`, `sha256`, `scanReport` ; sinon → **suppression de l'objet** Storage,
     `scanStatus=dirty|scan_failed`, audit `card_attachment_rejected` (raison, type, taille, sha256 — pas de
     nom de fichier sauf `dirty`, comme pour les mails).
5. **Nettoyage** : cron Inngest horaire `card-attachments-cleanup` → lignes `pending` de plus de 2 h 15 (> validité 2 h du jeton
   d'upload signé, sinon objet orphelin) et
   lignes `dirty`/`scan_failed` de plus de 7 jours : suppression objet (si présent) + ligne.

## 4. Consultation & suppression

- **`listCardAttachments(cardId)`** chargé avec les données du modal (`get-card-modal-data.ts`) : id, nom,
  type, taille, statut, auteur (nom), date.
- **`getCardAttachmentUrl({ attachmentId, disposition: 'inline' | 'attachment' })`** : accès carte vérifié,
  statut `clean` exigé, rate limit `card_attachment_download` (300 / h), URL signée TTL 300 s (`download`
  option pour `attachment`).
- **`deleteCardAttachment({ attachmentId })`** : auteur **ou** Admin ; Viewer refusé ; supprime l'objet puis
  la ligne ; audit `card_attachment_deleted`.
- Viewers : voir + télécharger, pas d'ajout ni de suppression.
- Compteur `attachmentCount` (PJ `clean`) chargé avec les cartes du Kanban → badge 📎 N sur `kanban-card`.

## 5. Interface

- **Section « Pièces jointes »** dans `card-modal.tsx`, avant les commentaires (composant dédié
  `card-attachments-section.tsx`, le modal fait déjà > 1000 lignes) :
  - zone de dépôt (glisser-déposer + bouton « Ajouter des fichiers », `input[type=file] multiple accept=…`),
    message des types/tailles acceptés ;
  - pendant l'upload : ligne avec barre de progression ; puis badge « Analyse en cours… » tant que `pending`
    (rafraîchissement par polling 3 s du statut des PJ `pending` de la carte, arrêté à 2 min) ; rejet → toast
    d'erreur explicite (« Fichier refusé par l'antivirus », « Type de fichier non autorisé », …) ;
  - grille : vignette (image via URL signée inline, `loading="lazy"`) ou icône par type ; nom, taille, auteur,
    date ; actions Télécharger / Supprimer (avec confirmation).
- **Visionneuse** `attachment-viewer.tsx` (dialog modal accessible : focus piégé, Échap, flèches ←/→ entre PJ,
  bouton Télécharger) : image `<img>`, vidéo `<video controls preload="metadata">`, PDF via `blob:` dans un
  `<iframe>`, autres types → téléchargement direct.
- **Carte Kanban** : icône trombone + nombre si > 0 (accessible : « 3 pièces jointes »).
- Textes FR en dur comme le modal existant ; tokens de thème (lot B) — le garde-fou couleurs s'applique.

## 6. Sécurité (récapitulatif)

- Le binaire ne transite jamais par nos fonctions depuis le client ; le chemin Storage est imposé par le
  serveur (jeton d'upload lié au chemin, valide 2 h, réutilisable tant qu'aucun objet n'existe au
  chemin — `upsert: false` : un seul objet par chemin, jamais d'écrasement).
- Liste blanche type + extension, contrôle des octets réels, taille réelle, scan ClamAV obligatoire ; aucun
  fichier servi tant que `scanStatus !== 'clean'`.
- Bucket privé, URLs signées courtes ; toutes les requêtes Prisma scopées `workspaceId` + scope projet ; RLS.
- Rate limits upload / download ; noms de fichiers jamais loggés (sauf audit `dirty`, comme les mails).
- CSP : ajouts minimaux (`media-src` hôte Supabase + `blob:`, `frame-src 'self' blob:` — `frame-src` ne régit que ce que nous embarquons ; `X-Frame-Options: DENY` protège toujours nos pages).

## 7. Infra (côté utilisateur, documenté dans le runbook)

- Appliquer la migration (procédure `db execute` + `migrate resolve`).
- Créer le bucket `card-attachments` (SQL du runbook).
- ClamAV sur Fly : relever `StreamMaxLength` à **50M** (et vérifier la RAM de la machine).
- Synchroniser Inngest (nouvelle fonction + cron) après déploiement.

## 8. Tests

- **Domain** : liste blanche, assainissement nom, `attachmentKind`, `isSniffCompatible` (100 %).
- **Server Actions** : request (Viewer refusé, scope, type/taille refusés, quota 50, rate limit, ligne créée,
  URL signée), finalize (propriétaire, statut), getUrl (non-clean refusé, scope), delete (auteur/Admin).
- **Fonction Inngest** : clean, dirty (objet supprimé + audit), type spoof, taille incohérente, objet absent,
  ClamAV injoignable → `scan_failed`.
- **Cleanup** : sélection des lignes périmées.
- **Composants** : section (dépôt, progression, statuts, suppression), visionneuse (clavier, types), badge
  Kanban.
- **CSP** : test du middleware sur les nouvelles directives.
- **Manuel (preview)** : image, vidéo, PDF, docx ; fichier EICAR → rejeté ; fichier renommé (exe → .pdf) →
  rejeté.

## Hors périmètre / dette notée

- Miniatures générées côté serveur, transcodage vidéo.
- Purge des fichiers à la suppression définitive d'un projet (corbeille 30 j) : les PJ suivent la carte
  (cascade DB) mais les objets Storage d'un projet purgé restent → à traiter avec la purge de corbeille.
- **Dette existante à vérifier** : l'upload des PJ **mail** passe le binaire dans une Server Action sans
  `bodySizeLimit` → limité en pratique à 1 Mo (Next) / 4,5 Mo (Vercel) malgré le « 25 Mo » annoncé. Le même
  pattern d'upload direct pourra y être appliqué dans un lot dédié.
