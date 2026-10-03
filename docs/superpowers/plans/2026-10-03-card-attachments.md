# Lot C — Pièces jointes de cartes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Joindre images / vidéos / PDF / documents (≤ 50 Mo) aux cartes, avec upload direct vers Supabase Storage, scan ClamAV asynchrone (Inngest) et visionneuse dans le modal.

**Architecture:** Server Action « request » (contrôles + ligne `pending` + URL d'upload signée) → upload direct navigateur → Server Action « finalize » → événement Inngest → job de scan (taille réelle, magic bytes, ClamAV) → `clean` ou suppression. Lecture uniquement via URL signée courte pour les PJ `clean`. Règles pures dans `packages/domain/src/attachments`.

**Tech Stack:** Next.js 15 Server Actions, Prisma 6, Supabase Storage (`createSignedUploadUrl`, `createSignedUrl`), Inngest v4, ClamAV (`@nexushub/integrations/antivirus`), `file-type`, Vitest + Testing Library.

**Spec :** `docs/superpowers/specs/2026-10-03-card-attachments-design.md`

**Conventions repo :**

- Tests : `pnpm --filter @nexushub/web exec vitest run <chemin>` ; domain : `pnpm --filter @nexushub/domain exec vitest run <chemin>`.
- Avant commit : `pnpm --filter <pkg> typecheck` (+ `lint` web, `--max-warnings=0`) ; `pnpm format:check` doit passer (CI).
- TS strict : `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` (→ `obj['key']` sur les index signatures, ex. `dataset['x']`).
- Commits Conventional, header ≤ 100 car., scopes `web, db, domain, ui, infra` ; trailer `Co-Authored-By: <modèle> <noreply@anthropic.com>` ; jamais `--no-verify`.
- Mocks Vitest : utiliser `vi.hoisted` pour toute variable référencée dans un `vi.mock` factory.
- **Aucune migration appliquée par un agent** ; aucune dépendance nouvelle.
- Garde-fou couleurs (`apps/web/lib/theme/no-hardcoded-colors.test.ts`) : uniquement des tokens (`var(--color-…)`).

---

## File Structure

| Fichier                                                                                                                              | Rôle                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `packages/domain/src/attachments/index.ts` (+ test)                                                                                  | constantes, liste blanche, assainissement, kind, sniff |
| `packages/db/prisma/schema.prisma` + migration                                                                                       | `CardAttachment`, valeurs `AuditAction`                |
| `apps/web/lib/rate-limit/index.ts`                                                                                                   | clés `card_attachment_upload` / `_download`            |
| `apps/web/lib/card-attachment-storage.ts` (+ test)                                                                                   | wrapper Storage (bucket `card-attachments`)            |
| `apps/web/features/projects/lib/card-attachment-core.ts` (+ test)                                                                    | accès carte, DTO, permissions                          |
| `apps/web/features/projects/actions/card-attachments.ts` (+ test)                                                                    | request / finalize / list / getUrl / delete            |
| `apps/web/lib/inngest/functions/scan-card-attachment.ts` (+ tests)                                                                   | scan asynchrone                                        |
| `apps/web/lib/inngest/functions/card-attachments-cleanup.ts` (+ test)                                                                | cron nettoyage                                         |
| `apps/web/features/projects/lib/upload-to-signed-url.ts` (+ test)                                                                    | XHR PUT avec progression                               |
| `apps/web/features/projects/components/card-attachments-section.tsx` (+ test)                                                        | section du modal                                       |
| `apps/web/features/projects/components/attachment-viewer.tsx` (+ test)                                                               | visionneuse                                            |
| `apps/web/features/projects/actions/get-card-modal-data.ts`, `card-modal.tsx`, `kanban-card.tsx`, `app/(app)/projects/[id]/page.tsx` | intégration                                            |
| `apps/web/middleware.ts`                                                                                                             | CSP `media-src`, `frame-src`                           |
| `docs/runbooks/card-attachments.md`                                                                                                  | bucket, ClamAV, migration, Inngest                     |

---

### Task 1: Domain — règles des pièces jointes

**Files:** Create `packages/domain/src/attachments/index.ts`, `packages/domain/src/attachments/attachments.test.ts` ; Modify `packages/domain/src/index.ts` (`export * from './attachments/index';`).

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  CARD_ATTACHMENT_MAX_BYTES,
  CARD_ATTACHMENT_MAX_PER_CARD,
  ALLOWED_CARD_ATTACHMENT_TYPES,
  attachmentKind,
  isAllowedAttachment,
  isSniffCompatible,
  sanitizeAttachmentFilename,
} from './index';

describe('limits', () => {
  it('caps size at 50 MB and count at 50', () => {
    expect(CARD_ATTACHMENT_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(CARD_ATTACHMENT_MAX_PER_CARD).toBe(50);
  });
});

describe('sanitizeAttachmentFilename', () => {
  it('strips control chars and path separators, trims, caps at 255', () => {
    expect(sanitizeAttachmentFilename('  ../a\\b/c\u0000.pdf ')).toBe('..abc.pdf');
    expect(sanitizeAttachmentFilename('x'.repeat(300) + '.png')).toHaveLength(255);
  });
  it('falls back when empty', () => {
    expect(sanitizeAttachmentFilename('   ')).toBe('fichier');
  });
});

describe('isAllowedAttachment', () => {
  it('accepts allow-listed extension + matching MIME', () => {
    expect(isAllowedAttachment('photo.JPG', 'image/jpeg')).toBe(true);
    expect(isAllowedAttachment('clip.mov', 'video/quicktime')).toBe(true);
    expect(isAllowedAttachment('brief.pdf', 'application/pdf')).toBe(true);
    expect(
      isAllowedAttachment(
        'deck.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe(true);
  });
  it('rejects unknown extension, mismatched MIME, or no extension', () => {
    expect(isAllowedAttachment('setup.exe', 'application/octet-stream')).toBe(false);
    expect(isAllowedAttachment('photo.jpg', 'application/pdf')).toBe(false);
    expect(isAllowedAttachment('README', 'text/plain')).toBe(false);
    expect(isAllowedAttachment('page.html', 'text/html')).toBe(false);
  });
});

describe('attachmentKind', () => {
  it('maps MIME to a preview kind', () => {
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('video/mp4')).toBe('video');
    expect(attachmentKind('application/pdf')).toBe('pdf');
    expect(attachmentKind('text/csv')).toBe('file');
  });
});

describe('isSniffCompatible', () => {
  it('accepts exact matches', () => {
    expect(isSniffCompatible('image/png', 'image/png')).toBe(true);
  });
  it('accepts Office OOXML sniffed as zip', () => {
    expect(
      isSniffCompatible(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/zip',
      ),
    ).toBe(true);
  });
  it('accepts text types that cannot be sniffed (undefined)', () => {
    expect(isSniffCompatible('text/plain', undefined)).toBe(true);
    expect(isSniffCompatible('text/csv', undefined)).toBe(true);
  });
  it('rejects binaries that cannot be sniffed and real spoofs', () => {
    expect(isSniffCompatible('application/pdf', undefined)).toBe(false);
    expect(isSniffCompatible('application/pdf', 'application/x-msdownload')).toBe(false);
    expect(isSniffCompatible('image/jpeg', 'image/png')).toBe(false);
  });
  it('accepts quicktime/mp4 container aliases', () => {
    expect(isSniffCompatible('video/quicktime', 'video/quicktime')).toBe(true);
    expect(isSniffCompatible('video/mp4', 'video/mp4')).toBe(true);
  });
  it('exposes the allow-list', () => {
    expect(ALLOWED_CARD_ATTACHMENT_TYPES.length).toBeGreaterThanOrEqual(15);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module absent).

- [ ] **Step 3: Implement**

```ts
/**
 * Pièces jointes de cartes (spec lot C §2). Pur TS — liste blanche
 * extension + MIME, assainissement du nom, contrôle magic bytes.
 */
export const CARD_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const CARD_ATTACHMENT_MAX_PER_CARD = 50;

export type AttachmentKind = 'image' | 'video' | 'pdf' | 'file';

interface AllowedType {
  readonly ext: readonly string[];
  readonly mime: string;
}

const OOXML = 'application/vnd.openxmlformats-officedocument';

export const ALLOWED_CARD_ATTACHMENT_TYPES: readonly AllowedType[] = [
  { ext: ['jpg', 'jpeg'], mime: 'image/jpeg' },
  { ext: ['png'], mime: 'image/png' },
  { ext: ['gif'], mime: 'image/gif' },
  { ext: ['webp'], mime: 'image/webp' },
  { ext: ['heic'], mime: 'image/heic' },
  { ext: ['mp4'], mime: 'video/mp4' },
  { ext: ['mov'], mime: 'video/quicktime' },
  { ext: ['webm'], mime: 'video/webm' },
  { ext: ['pdf'], mime: 'application/pdf' },
  { ext: ['docx'], mime: `${OOXML}.wordprocessingml.document` },
  { ext: ['xlsx'], mime: `${OOXML}.spreadsheetml.sheet` },
  { ext: ['pptx'], mime: `${OOXML}.presentationml.presentation` },
  { ext: ['txt'], mime: 'text/plain' },
  { ext: ['csv'], mime: 'text/csv' },
  { ext: ['zip'], mime: 'application/zip' },
];

/** Accept attribute pour `<input type="file">`. */
export const CARD_ATTACHMENT_ACCEPT = ALLOWED_CARD_ATTACHMENT_TYPES.flatMap((t) =>
  t.ext.map((e) => `.${e}`),
).join(',');

export function sanitizeAttachmentFilename(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f/\\]/g, '')
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : 'fichier';
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot <= 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

export function isAllowedAttachment(filename: string, contentType: string): boolean {
  const ext = extensionOf(filename);
  const mime = contentType.toLowerCase();
  return ALLOWED_CARD_ATTACHMENT_TYPES.some((t) => t.mime === mime && t.ext.includes(ext));
}

export function attachmentKind(contentType: string): AttachmentKind {
  const mime = contentType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

const TEXT_TYPES = new Set(['text/plain', 'text/csv']);

/**
 * `sniffed` = MIME détecté par magic bytes (`file-type`), `undefined` si non
 * détectable. Les formats texte ne sont pas détectables → acceptés ; tout
 * autre format non détectable est refusé (fail-closed).
 */
export function isSniffCompatible(declared: string, sniffed: string | undefined): boolean {
  const d = declared.toLowerCase();
  if (sniffed === undefined) return TEXT_TYPES.has(d);
  const s = sniffed.toLowerCase();
  if (s === d) return true;
  if (d.startsWith(`${OOXML}.`) && s === 'application/zip') return true;
  return false;
}
```

- [ ] **Step 4: Run** → PASS ; `pnpm --filter @nexushub/domain typecheck && pnpm --filter @nexushub/domain lint`. (Si `file-type` renvoie un MIME OOXML exact pour docx/xlsx/pptx — c'est le cas de `file-type` v22 —, le cas « égal » le couvre déjà.)
- [ ] **Step 5: Commit** — `feat(domain): card attachment rules (allow-list, sniff, sanitize)`

---

### Task 2: DB — `CardAttachment` + audit + rate limits

**Files:** Modify `packages/db/prisma/schema.prisma`, `apps/web/lib/rate-limit/index.ts` ; Create `packages/db/prisma/migrations/20261003150000_card_attachments/migration.sql`.

- [ ] **Step 1: Schema**

```prisma
/// Pièce jointe de carte (lot C). Binaire dans le bucket privé
/// `card-attachments` ; jamais servi tant que `scanStatus != clean`.
model CardAttachment {
  id           String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId  String               @map("workspace_id") @db.Uuid
  cardId       String               @map("card_id") @db.Uuid
  uploadedById String?              @map("uploaded_by_id") @db.Uuid
  filename     String               @db.VarChar(255)
  contentType  String               @map("content_type") @db.VarChar(255)
  sizeBytes    Int                  @map("size_bytes")
  storagePath  String               @unique @map("storage_path") @db.VarChar(512)
  scanStatus   AttachmentScanStatus @default(pending) @map("scan_status")
  sha256       String?              @db.Char(64)
  scanReport   Json?                @map("scan_report")
  createdAt    DateTime             @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime             @updatedAt @map("updated_at") @db.Timestamptz(6)

  card       Card  @relation(fields: [cardId], references: [id], onDelete: Cascade)
  uploadedBy User? @relation("CardAttachmentUploadedBy", fields: [uploadedById], references: [id], onDelete: SetNull)

  @@index([workspaceId, cardId])
  @@index([scanStatus, createdAt])
  @@map("card_attachments")
}
```

Ajouter `attachments CardAttachment[]` dans `model Card`, `cardAttachmentsUploaded CardAttachment[] @relation("CardAttachmentUploadedBy")` dans `model User`. Dans `enum AuditAction`, ajouter `card_attachment_rejected` et `card_attachment_deleted`. Ne pas lancer `prisma format` sur tout le fichier (diff bruité) ; aligner à la main.

- [ ] **Step 2: Migration SQL**

```sql
-- Lot C : pièces jointes de cartes.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'card_attachment_rejected';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'card_attachment_deleted';

CREATE TABLE "card_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "uploaded_by_id" UUID,
  "filename" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(255) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_path" VARCHAR(512) NOT NULL,
  "scan_status" "AttachmentScanStatus" NOT NULL DEFAULT 'pending',
  "sha256" CHAR(64),
  "scan_report" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "card_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_attachments_card_id_fkey" FOREIGN KEY ("card_id")
    REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "card_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "card_attachments_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 52428800)
);

CREATE UNIQUE INDEX "card_attachments_storage_path_key" ON "card_attachments"("storage_path");
CREATE INDEX "card_attachments_workspace_id_card_id_idx" ON "card_attachments"("workspace_id", "card_id");
CREATE INDEX "card_attachments_scan_status_created_at_idx" ON "card_attachments"("scan_status", "created_at");

ALTER TABLE public.card_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_attachments_member_all ON public.card_attachments FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));
```

- [ ] **Step 3: Rate limits** — dans `RateLimitKey` ajouter `'card_attachment_upload' | 'card_attachment_download'`, et dans `WINDOWS` : `card_attachment_upload: { limit: 60, window: '1 h' }`, `card_attachment_download: { limit: 300, window: '1 h' }`. Adapter `rate-limit/index.test.ts` si elle énumère les clés.

- [ ] **Step 4: Verify** — `DATABASE_URL=postgresql://u:p@localhost:5432/db DIRECT_URL=postgresql://u:p@localhost:5432/db pnpm --filter @nexushub/db exec prisma validate` puis `… prisma generate` (URLs factices, aucune connexion) ; `pnpm --filter @nexushub/web typecheck` ; `pnpm --filter @nexushub/web exec vitest run lib/rate-limit`.
- [ ] **Step 5: Commit** — `feat(db): card_attachments table, audit actions, rate limits`

---

### Task 3: Wrapper Storage

**Files:** Create `apps/web/lib/card-attachment-storage.ts`, `apps/web/lib/card-attachment-storage.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
  const bucket = {
    createSignedUploadUrl: vi.fn(),
    createSignedUrl: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
  };
  return { bucket, from: vi.fn(() => bucket) };
});
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({ storage: { from: m.from } }),
}));

import {
  CARD_ATTACHMENTS_BUCKET,
  cardAttachmentPath,
  createCardAttachmentUploadUrl,
  getCardAttachmentSignedUrl,
  downloadCardAttachment,
  removeCardAttachment,
} from './card-attachment-storage';

beforeEach(() => {
  for (const f of Object.values(m.bucket)) f.mockReset();
  m.from.mockClear();
});

describe('card attachment storage', () => {
  it('builds the workspace/card/id path', () => {
    expect(cardAttachmentPath('ws', 'card', 'att')).toBe('ws/card/att');
  });

  it('creates a signed upload URL in the private bucket', async () => {
    m.bucket.createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: 'https://x/upload?token=t', token: 't', path: 'ws/card/att' },
      error: null,
    });
    const res = await createCardAttachmentUploadUrl('ws/card/att');
    expect(m.from).toHaveBeenCalledWith(CARD_ATTACHMENTS_BUCKET);
    expect(res).toEqual({
      ok: true,
      signedUrl: 'https://x/upload?token=t',
      token: 't',
      path: 'ws/card/att',
    });
  });

  it('signs read URLs for 300 s, with download disposition when asked', async () => {
    m.bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/r' }, error: null });
    await getCardAttachmentSignedUrl('p', { download: 'a.pdf' });
    expect(m.bucket.createSignedUrl).toHaveBeenCalledWith('p', 300, { download: 'a.pdf' });
    await getCardAttachmentSignedUrl('p', {});
    expect(m.bucket.createSignedUrl).toHaveBeenLastCalledWith('p', 300, undefined);
  });

  it('downloads to a Buffer and reports missing objects', async () => {
    m.bucket.download.mockResolvedValueOnce({
      data: new Blob([new Uint8Array([1, 2])]),
      error: null,
    });
    const ok = await downloadCardAttachment('p');
    expect(ok.ok && ok.binary.length).toBe(2);
    m.bucket.download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    expect((await downloadCardAttachment('p')).ok).toBe(false);
  });

  it('remove is best-effort', async () => {
    m.bucket.remove.mockRejectedValue(new Error('boom'));
    await expect(removeCardAttachment('p')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```ts
import 'server-only';
import { createSupabaseAdmin } from '@/lib/supabase/server';

/**
 * Bucket privé des pièces jointes de cartes (spec lot C §1). Service role
 * uniquement ; le client n'obtient qu'un jeton d'upload à usage unique lié
 * au chemin, ou une URL de lecture signée de 300 s pour une PJ `clean`.
 * Ne jamais renvoyer `message` d'erreur au client (infos d'infra).
 */
export const CARD_ATTACHMENTS_BUCKET = 'card-attachments';
const READ_TTL_SECONDS = 300;

export function cardAttachmentPath(
  workspaceId: string,
  cardId: string,
  attachmentId: string,
): string {
  return `${workspaceId}/${cardId}/${attachmentId}`;
}

type Fail = { readonly ok: false; readonly message: string };

export async function createCardAttachmentUploadUrl(
  path: string,
): Promise<
  | { readonly ok: true; readonly signedUrl: string; readonly token: string; readonly path: string }
  | Fail
> {
  const { data, error } = await createSupabaseAdmin()
    .storage.from(CARD_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: error?.message ?? 'Sign upload failed' };
  return { ok: true, signedUrl: data.signedUrl, token: data.token, path: data.path };
}

export async function getCardAttachmentSignedUrl(
  path: string,
  opts: { readonly download?: string },
): Promise<{ readonly ok: true; readonly signedUrl: string } | Fail> {
  const { data, error } = await createSupabaseAdmin()
    .storage.from(CARD_ATTACHMENTS_BUCKET)
    .createSignedUrl(
      path,
      READ_TTL_SECONDS,
      opts.download ? { download: opts.download } : undefined,
    );
  if (error || !data) return { ok: false, message: error?.message ?? 'Sign failed' };
  return { ok: true, signedUrl: data.signedUrl };
}

export async function downloadCardAttachment(
  path: string,
): Promise<{ readonly ok: true; readonly binary: Buffer } | Fail> {
  const { data, error } = await createSupabaseAdmin()
    .storage.from(CARD_ATTACHMENTS_BUCKET)
    .download(path);
  if (error || !data) return { ok: false, message: error?.message ?? 'Download failed' };
  return { ok: true, binary: Buffer.from(await data.arrayBuffer()) };
}

export async function removeCardAttachment(path: string): Promise<void> {
  try {
    await createSupabaseAdmin().storage.from(CARD_ATTACHMENTS_BUCKET).remove([path]);
  } catch {
    /* best-effort */
  }
}
```

- [ ] **Step 4: Run** → PASS, typecheck, lint.
- [ ] **Step 5: Commit** — `feat(web): card attachments storage wrapper`

---

### Task 4: Core + Server Actions

**Files:** Create `apps/web/features/projects/lib/card-attachment-core.ts` (+ `.test.ts`), `apps/web/features/projects/actions/card-attachments.ts` (+ `.test.ts`).

**Core** (`card-attachment-core.ts`, `import 'server-only'`) — exports :

```ts
export interface CardAttachmentDTO {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly scanStatus: 'pending' | 'clean' | 'dirty' | 'scan_failed';
  readonly uploaderName: string | null;
  readonly createdAt: string; // ISO
  readonly canDelete: boolean;
}

/** Carte accessible (workspace + scope projet), non supprimée. null sinon. */
export async function loadAccessibleCard(
  ctx: AuthContext,
  cardId: string,
): Promise<{ id: string; projectId: string } | null>;

/** PJ de la carte visibles (non dirty/scan_failed), triées par createdAt asc. */
export async function listCardAttachmentDTOs(
  ctx: AuthContext,
  cardId: string,
): Promise<CardAttachmentDTO[]>;

/** Auteur ou Admin (jamais Viewer). */
export function canDeleteAttachment(ctx: AuthContext, uploadedById: string | null): boolean;
```

Implémentation : `loadAccessibleCard` = `prisma.card.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null }, select: { id, projectId, project: { select: { clientId } } } })` + `loadUserScope(ctx)` (restricted → `projectIds.includes || clientIds.includes`, même logique que `get-card-modal-data.ts`). `listCardAttachmentDTOs` = `prisma.cardAttachment.findMany({ where: { workspaceId: ctx.workspaceId, cardId, scanStatus: { in: ['pending', 'clean'] } }, orderBy: { createdAt: 'asc' }, select: { …, uploadedById, uploadedBy: { select: { firstName, lastName, email } } } })` ; `uploaderName` = prénom nom ou email ; `canDelete = canDeleteAttachment(ctx, row.uploadedById)` ; `canDeleteAttachment` = `ctx.role !== Roles.Viewer && (ctx.role === Roles.Admin || uploadedById === ctx.userId)`.

Tests core : scope restreint refuse, carte d'un autre workspace → null, DTO (nom auteur, canDelete auteur/Admin/Member non-auteur/Viewer).

**Actions** (`card-attachments.ts`, `'use server'`, toutes `requireUser()` puis Zod) :

```ts
export type AttachmentActionError = { readonly ok: false; readonly code: string; readonly message: string };

requestCardAttachmentUpload(input: { cardId; filename; contentType; sizeBytes })
  → { ok: true; attachmentId; signedUrl; token; path } | AttachmentActionError
finalizeCardAttachment(input: { attachmentId }) → { ok: true } | AttachmentActionError
listCardAttachments(input: { cardId }) → { ok: true; attachments: CardAttachmentDTO[] } | AttachmentActionError
getCardAttachmentUrl(input: { attachmentId; disposition: 'inline' | 'attachment' }) → { ok: true; url } | AttachmentActionError
deleteCardAttachment(input: { attachmentId }) → { ok: true } | AttachmentActionError
```

Règles (dans cet ordre) :

- **request** : Viewer → `{code:'FORBIDDEN', message:'Action indisponible : rôle Viewer en lecture seule.'}` ; Zod (`cardId` uuid, `filename` string 1..1000, `contentType` regex `^[\w.+-]+/[\w.+-]+$`, `sizeBytes` int > 0) → `INVALID_INPUT` ; `loadAccessibleCard` null → `NOT_FOUND` ; rate limit `card_attachment_upload` (clé `ctx.userId`) → `RATE_LIMIT` ; `filename = sanitizeAttachmentFilename(...)` ; `!isAllowedAttachment(filename, contentType)` → `TYPE_NOT_ALLOWED` (« Type de fichier non autorisé. ») ; `sizeBytes > CARD_ATTACHMENT_MAX_BYTES` → `TOO_LARGE` (« Fichier trop volumineux (max 50 Mo). ») ; `count({ where: { workspaceId, cardId, scanStatus: { in: ['pending','clean'] } } }) >= CARD_ATTACHMENT_MAX_PER_CARD` → `TOO_MANY` ; `id = randomUUID()`, `path = cardAttachmentPath(ws, cardId, id)` ; `createCardAttachmentUploadUrl(path)` échec → `UPLOAD_FAILED` (message générique) ; puis `prisma.cardAttachment.create({ data: { id, workspaceId, cardId, uploadedById: ctx.userId, filename, contentType: contentType.toLowerCase(), sizeBytes, storagePath: path } })` ; retour.
- **finalize** : ligne `findFirst({ where: { id, workspaceId, uploadedById: ctx.userId, scanStatus: 'pending' } })` sinon `NOT_FOUND` ; `inngestClient.send({ name: 'card-attachment/uploaded', data: { attachmentId: id } })` ; `{ ok: true }`.
- **list** : `loadAccessibleCard` sinon `NOT_FOUND` ; `listCardAttachmentDTOs`.
- **getUrl** : rate limit `card_attachment_download` ; ligne scopée workspace ; `loadAccessibleCard(row.cardId)` ; `scanStatus !== 'clean'` → `NOT_READY` ; `getCardAttachmentSignedUrl(path, disposition === 'attachment' ? { download: row.filename } : {})`.
- **delete** : ligne scopée workspace + `loadAccessibleCard` ; `!canDeleteAttachment` → `FORBIDDEN` ; `removeCardAttachment(path)` puis `prisma.cardAttachment.delete` ; `auditLog.create({ action: 'card_attachment_deleted', workspaceId, actorId, subjectType: 'card_attachment', subjectId: id, data: { contentType, sizeBytes } })` (pas de nom de fichier).

- [ ] **Step 1: Failing tests** — `card-attachment-core.test.ts` et `card-attachments.test.ts` (mocks `@nexushub/db` prisma, `@/lib/auth`, `@/lib/auth/scope` `loadUserScope`, `@/lib/rate-limit` `getRateLimiter`, `@/lib/card-attachment-storage`, `@/lib/inngest/client` `inngestClient.send`), couvrant au minimum : request — Viewer refusé, type refusé (`.exe`), > 50 Mo refusé, quota 50, carte hors scope → NOT_FOUND, succès (ligne créée avec chemin `ws/card/<uuid>` et URL renvoyée), nom assaini ; finalize — autre utilisateur → NOT_FOUND, succès → `send` appelé avec `{ name: 'card-attachment/uploaded', data: { attachmentId } }` ; getUrl — `pending` → NOT_READY, `attachment` → option `download` = filename ; delete — Member non-auteur refusé, Admin OK, objet supprimé + audit sans filename.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** selon les règles ci-dessus (importer `inngestClient` depuis `@/lib/inngest/client`, `Roles` depuis `@nexushub/domain`, `randomUUID` depuis `node:crypto`).
- [ ] **Step 4: Run** → PASS ; typecheck ; lint.
- [ ] **Step 5: Commit** — `feat(web): card attachment server actions (request, finalize, url, delete)`

---

### Task 5: Inngest — scan + cleanup

**Files:** Create `apps/web/lib/inngest/functions/scan-card-attachment.ts` (+ `.test.ts`, `-imports.test.ts` calqué sur `blocked-cards-scan-imports.test.ts`), `card-attachments-cleanup.ts` (+ `.test.ts`) ; Modify `apps/web/lib/inngest/functions/index.ts` (ajouter les 2 fonctions au tableau `functions`).

Pattern du repo : un cœur pur `runScanCardAttachment(deps, attachmentId)` testé avec des fakes, l'export Inngest n'étant qu'un fil.

```ts
export interface ScanDeps {
  readonly loadAttachment: (id: string) => Promise<{
    id: string;
    workspaceId: string;
    storagePath: string;
    contentType: string;
    sizeBytes: number;
    scanStatus: 'pending' | 'clean' | 'dirty' | 'scan_failed';
  } | null>;
  readonly download: (
    path: string,
  ) => Promise<{ ok: true; binary: Buffer } | { ok: false; message: string }>;
  readonly sniff: (binary: Buffer) => Promise<string | undefined>; // fileTypeFromBuffer(b)?.mime
  readonly scan: (binary: Buffer) => Promise<{
    verdict: 'clean' | 'dirty' | 'scan_failed';
    detectingEngines?: readonly string[];
  }>;
  readonly markClean: (id: string, sha256: string, report: object) => Promise<void>;
  readonly reject: (
    row: {
      id: string;
      workspaceId: string;
      storagePath: string;
      contentType: string;
      sizeBytes: number;
    },
    status: 'dirty' | 'scan_failed',
    reason: string,
    sha256: string | null,
    engines: readonly string[],
  ) => Promise<void>;
}

export type ScanOutcome = 'skipped' | 'clean' | 'dirty' | 'scan_failed';
```

Logique `runScanCardAttachment` : ligne absente ou non `pending` → `skipped` ; download KO → `reject(…, 'scan_failed', 'missing_object', null, [])` ; `binary.length !== sizeBytes || > CARD_ATTACHMENT_MAX_BYTES` → `reject('dirty', 'size_mismatch')` ; `!isSniffCompatible(contentType, await sniff(binary))` → `reject('dirty', 'type_spoof')` ; sha256 ; `scan` → `clean` → `markClean(id, sha, { engine: 'clamav' })`, `dirty` → `reject('dirty', 'virus', sha, engines)`, `scan_failed` → `reject('scan_failed', 'scanner_error', sha, [])`.

Implémentations prod : `reject` = `removeCardAttachment(path)` + `prisma.cardAttachment.update({ scanStatus, sha256, scanReport: { reason } })` + `auditLog.create({ action: 'card_attachment_rejected', workspaceId, subjectType: 'card_attachment', subjectId: id, data: { reason, contentType, sizeBytes, sha256, detectingEngines } })` (aucun nom de fichier ; pour `virus`, ajouter `filename` comme pour les mails — exception d'investigation documentée) ; `scan` = `scanFileWithClamAV(binary, { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT })` via `getServerEnv()` — si `CLAMAV_HOST` absent → `{ verdict: 'scan_failed' }`.

Export Inngest :

```ts
export const scanCardAttachment = inngestClient.createFunction(
  {
    id: 'scan-card-attachment',
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: 'card-attachment/uploaded' }],
  },
  async ({ event, step }) => {
    const attachmentId = String((event.data as { attachmentId?: unknown }).attachmentId ?? '');
    return step.run('scan', () => runScanCardAttachment(prodDeps, attachmentId));
  },
);
```

(Vérifier la forme exacte des options v4 dans `blocked-cards-scan.ts` / la doc Inngest v4 si `concurrency`/`retries` diffèrent ; ne pas ajouter de dépendance.)

Cleanup : `runCardAttachmentsCleanup({ now, findStale, remove, deleteRow })` — `findStale` = lignes `pending` avec `createdAt < now-30min` OU (`dirty|scan_failed`) avec `updatedAt < now-7j` (limit 500) ; pour chacune `remove(path)` puis `deleteRow(id)` ; isolation par ligne (try/catch). Export `cardAttachmentsCleanup` cron `'15 * * * *'`.

- [ ] **Step 1: Failing tests** — scan : skipped (absent / déjà clean), clean (markClean appelé avec sha256 hex 64), virus → reject dirty + engines, type spoof (pdf déclaré, sniff `application/x-msdownload`), taille incohérente, objet absent → scan_failed, scanner KO → scan_failed. Cleanup : sélectionne/supprime, une erreur sur une ligne n'arrête pas les suivantes. Imports guard : pas d'import `@nexushub/agent` / provider / registry.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (+ tests existants `functions/index` éventuels), typecheck, lint.
- [ ] **Step 5: Commit** — `feat(web): inngest scan and cleanup for card attachments`

---

### Task 6: Données du modal + compteur Kanban

**Files:** Modify `apps/web/features/projects/actions/get-card-modal-data.ts`, `apps/web/app/(app)/projects/[id]/page.tsx`, `apps/web/features/projects/components/kanban-card.tsx` (+ test), et le payload minimal construit dans `card-modal-controller.tsx`.

- [ ] `CardModalData` gagne `readonly attachments: readonly CardAttachmentDTO[]` — chargé dans le `Promise.all` post-autorisation via `listCardAttachmentDTOs(ctx, card.id)`. Le payload minimal du controller (pendant le chargement) met `attachments: []`. Mettre à jour les tests existants qui construisent un `CardModalData` (grep `comments:` dans les tests du dossier) en ajoutant `attachments: []`.
- [ ] Kanban : dans le select des cartes de `[id]/page.tsx`, étendre `_count` : `_count: { select: { comments: { where: { deletedAt: null } }, attachments: { where: { scanStatus: 'clean' } } } }` et mapper `attachmentCount: c._count.attachments`. `KanbanCardData` gagne `readonly attachmentCount?: number`. Dans `kanban-card.tsx`, à côté du bloc `kcard-comments`, afficher (si > 0) un bloc `kcard-comments` identique avec une icône trombone SVG (`currentColor`) et le nombre, `aria-label` / `title` « N pièce(s) jointe(s) ». Test kanban-card : badge visible avec 2, absent avec 0.
- [ ] Typecheck, tests `features/projects`, lint. Commit — `feat(web): attachments in card modal payload + kanban badge`

---

### Task 7: UI — upload, section, visionneuse, CSP

**Files:** Create `apps/web/features/projects/lib/upload-to-signed-url.ts` (+ test), `card-attachments-section.tsx` (+ test), `attachment-viewer.tsx` (+ test) ; Modify `card-modal.tsx`, `apps/web/middleware.ts`, `packages/ui/src/tokens/components.css` (styles section/grille/viewer, tokens uniquement).

**Upload XHR** — `uploadToSignedUrl({ signedUrl, file, onProgress, signal }) → Promise<void>` : `XMLHttpRequest` `PUT signedUrl`, `setRequestHeader('Content-Type', file.type)`, `setRequestHeader('x-upsert', 'false')`, corps = `file` brut ; `upload.onprogress` → `onProgress(loaded/total)` ; résout sur status 2xx, rejette sinon / `onerror` / abort. Vérifier dans `node_modules/@supabase/storage-js` (`uploadToSignedUrl`) que l'URL signée accepte un PUT avec corps brut (sinon envoyer un `FormData` avec `cacheControl` et le fichier sous la clé `''`, comme le SDK) — documenter le choix en commentaire. Test : fake XHR (classe stub sur `globalThis.XMLHttpRequest`) → progress puis resolve ; 400 → reject.

**Section** `CardAttachmentsSection({ cardId, initial: CardAttachmentDTO[], canUpload: boolean })` :

- titre « Pièces jointes » + compteur ; si `canUpload` : zone de dépôt (`onDragOver/onDrop`, état visuel), bouton « Ajouter des fichiers » ouvrant `<input type="file" multiple accept={CARD_ATTACHMENT_ACCEPT} hidden>` ; aide « Images, vidéos, PDF, Office, txt, csv, zip — 50 Mo max ».
- pour chaque fichier choisi (max 3 en parallèle) : contrôle local (`isAllowedAttachment`, taille) → toast d'erreur sinon ; `requestCardAttachmentUpload` → ligne locale « upload » avec barre de progression (`role="progressbar"`, `aria-valuenow`) → `uploadToSignedUrl` → `finalizeCardAttachment` → ligne passe en `pending` (badge « Analyse en cours… ») ; erreurs → toast + retrait de la ligne.
- polling : tant qu'au moins une PJ est `pending`, `listCardAttachments` toutes les 3 s (arrêt après 2 min ou démontage) ; une PJ qui disparaît de la liste (rejetée) → toast « Fichier refusé par l'analyse antivirus. ».
- grille : image `clean` → `<img loading="lazy">` avec URL obtenue via `getCardAttachmentUrl(inline)` (cache local par id, renouvelée si > 4 min) ; autres → icône par `attachmentKind` ; nom (tronqué, `title` complet), taille formatée (Ko/Mo), auteur, date ; boutons « Télécharger » (`getCardAttachmentUrl(attachment)` → `window.location.assign(url)`) et « Supprimer » si `canDelete` (confirmation `window.confirm` remplacée par un petit dialog existant si le repo en a un, sinon `confirm`) ; clic sur la vignette/nom → visionneuse.
- émet `CARD_UPDATED_EVENT` avec `attachmentCount` mis à jour pour que le badge Kanban suive (étendre `CardUpdatedEventDetail` de façon optionnelle si nécessaire).

**Visionneuse** `AttachmentViewer({ items, index, onClose, onIndexChange })` : `role="dialog" aria-modal="true" aria-label={filename}`, portail sur `body`, focus initial sur le bouton fermer, Échap ferme, ←/→ navigue ; contenu selon `attachmentKind` : image `<img alt={filename}>`, vidéo `<video controls preload="metadata" src={url}>`, PDF : `fetch(url)` → `URL.createObjectURL(blob)` → `<iframe title={filename} src={blobUrl}>` (révoquer au démontage), autre → message + bouton Télécharger. Bouton « Télécharger » toujours présent.

**Intégration modal** : dans `card-modal.tsx`, juste avant le bloc `CardCommentsThread` (hors `fieldset`), `{!isLoading ? <CardAttachmentsSection cardId={card.id} initial={card.attachments} canUpload={!isReadOnly} /> : null}`.

**CSP** (`middleware.ts`) : ajouter `media-src 'self' blob: https://${supabaseHost}` et `frame-src 'self' blob:` au tableau `csp`. (Les vignettes passent déjà par `img-src https:`, l'upload par `connect-src` Supabase.)

- [ ] **Step 1: Failing tests** — upload XHR ; section : rend les PJ initiales, bouton Supprimer seulement si `canDelete`, zone d'ajout absente si `!canUpload`, choix d'un `.exe` → toast et aucun appel serveur, flux nominal (request → upload → finalize → badge « Analyse en cours… »), polling passe à clean ; viewer : Échap ferme, flèches naviguent, vidéo rend `<video>`, PDF crée une URL blob.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS ; full `pnpm --filter @nexushub/web exec vitest run` (garde-fou couleurs inclus) ; typecheck ; lint ; `pnpm format:check`.
- [ ] **Step 5: Commit(s)** — `feat(web): card attachments section, viewer and upload` et `feat(web): CSP media-src and frame-src blob for attachments`

---

### Task 8: Runbook, docs, vérification, PR

- [ ] `docs/runbooks/card-attachments.md` : (1) migration — `db execute --file …/20261003150000_card_attachments/migration.sql` puis `prisma migrate resolve --applied 20261003150000_card_attachments` (ne JAMAIS `migrate deploy` : registre en dérive) ; (2) bucket :

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('card-attachments', 'card-attachments', false, 52428800, ARRAY[
  'image/jpeg','image/png','image/gif','image/webp','image/heic',
  'video/mp4','video/quicktime','video/webm','application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv','application/zip']);
```

(aucune policy `storage.objects` pour anon/authenticated : tout passe par service role / URL signée) ; (3) ClamAV Fly : `StreamMaxLength 50M` (variable/`clamd.conf` selon l'image), redéployer, vérifier RAM ; (4) Inngest : resynchroniser l'app après déploiement (nouvelles fonctions `scan-card-attachment`, `card-attachments-cleanup`) ; (5) tests manuels (EICAR, exe renommé en .pdf, vidéo 40 Mo).

- [ ] `progress.md` (entrée 2026-10-03 lot C + dette PJ mail) ; `CLAUDE.md` §11 (ligne lot C) et §4.5.4 (mention « PJ de cartes : upload direct + scan asynchrone, jamais servies avant `clean` »).
- [ ] `pnpm turbo run typecheck lint test --filter=@nexushub/domain --filter=@nexushub/ui --filter=@nexushub/web` + `pnpm format:check` → vert.
- [ ] Commit `docs(web): card attachments runbook, progress, CLAUDE.md`, push, PR vers `main` (template Contexte / Changements / Tests / Risques sécurité / Infra à faire).
