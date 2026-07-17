'use client';
import { useCallback, useState } from 'react';
import { uploadAttachment } from '../actions/upload-attachment';

/**
 * useAttachmentUploader — client-side per-file state machine wrapping the
 * Task 12 `uploadAttachment` server action (Communications iter V1.5,
 * Task 18). Consumed by `AttachmentDrop` and wired into ComposePanel in
 * Task 19: `composePanel` reads `.items`/`.totalBytes` for rendering and
 * autosave/send payloads, and calls `.addFiles`/`.removeItem`/`.setInitial`.
 *
 * No `draftId` argument: `uploadAttachment` and `removeAttachmentFromDraft`
 * both derive scope from the JWT session via `requireUser()` server-side —
 * MailDraft has a unique (workspaceId, userId) constraint (one draft per
 * user, see mail-drafts.ts), so there's nothing for the client to pass.
 *
 * No `scanning` state: the ClamAV scan happens synchronously inside the
 * `uploadAttachment` server action (see its header note on the
 * VirusTotal→ClamAV pivot), so a file goes straight from `uploading` to a
 * terminal state (`clean` | `dirty` | `error`) once the action resolves —
 * there's no separate async "scan in progress" phase to represent client-side.
 */

export type AttachmentUploadState = 'uploading' | 'clean' | 'dirty' | 'error';

export interface UploadedAttachment {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly storagePath: string;
  readonly sha256: string;
  readonly state: AttachmentUploadState;
  readonly error?: string;
}

/** Spec §5.1: 20 files max per mail. */
export const MAX_ATTACHMENTS = 20;
/** Spec §5.1: 25 MB per file (mirrors `MAX_SIZE_BYTES` in upload-attachment.ts). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface AddFilesResult {
  /** Files actually sent to the server. */
  readonly accepted: number;
  /** Files dropped silently because the 20-file cap was already reached. */
  readonly capRejected: number;
  /** Files rejected client-side (before any network call) for exceeding 25 MB. */
  readonly oversizeRejected: number;
}

let placeholderSeq = 0;
function placeholderId(): string {
  placeholderSeq += 1;
  return `pending-${Date.now()}-${placeholderSeq}`;
}

export function useAttachmentUploader() {
  const [items, setItems] = useState<readonly UploadedAttachment[]>([]);

  const addFiles = useCallback(
    async (files: readonly File[]): Promise<AddFilesResult> => {
      const remaining = Math.max(MAX_ATTACHMENTS - items.length, 0);
      const withinCap = files.slice(0, remaining);
      const capRejected = files.length - withinCap.length;

      // Client-side size pre-check (spec §5.1) — reject BEFORE hitting the
      // server. Redundant with the server's own MAX_SIZE_BYTES check
      // (belt and suspenders per CLAUDE.md §4.5), but saves a round trip
      // and gives instant feedback. Oversized files still get a visible
      // row (state 'error') rather than vanishing silently.
      const accepted: File[] = [];
      const oversized: File[] = [];
      for (const file of withinCap) {
        if (file.size > MAX_FILE_BYTES) {
          oversized.push(file);
        } else {
          accepted.push(file);
        }
      }

      const acceptedPlaceholders: UploadedAttachment[] = accepted.map((f) => ({
        id: placeholderId(),
        filename: f.name,
        contentType: f.type || 'application/octet-stream',
        sizeBytes: f.size,
        storagePath: '',
        sha256: '',
        state: 'uploading',
      }));
      const oversizedEntries: UploadedAttachment[] = oversized.map((f) => ({
        id: placeholderId(),
        filename: f.name,
        contentType: f.type || 'application/octet-stream',
        sizeBytes: f.size,
        storagePath: '',
        sha256: '',
        state: 'error',
        error: 'Fichier trop volumineux (max 25 MB).',
      }));

      setItems((prev) => [...prev, ...acceptedPlaceholders, ...oversizedEntries]);

      if (accepted.length > 0) {
        const results = await Promise.allSettled(
          accepted.map(async (file) => {
            const fd = new FormData();
            fd.append('file', file);
            return uploadAttachment(fd);
          }),
        );

        setItems((prev) => {
          const next = [...prev];
          results.forEach((res, i) => {
            const placeholderEntryId = acceptedPlaceholders[i]?.id;
            if (!placeholderEntryId) return;
            const idx = next.findIndex((x) => x.id === placeholderEntryId);
            const current = idx === -1 ? undefined : next[idx];
            if (idx === -1 || !current) return;
            if (res.status === 'fulfilled' && res.value.ok) {
              next[idx] = {
                id: res.value.id,
                filename: res.value.filename,
                contentType: res.value.contentType,
                sizeBytes: res.value.sizeBytes,
                storagePath: res.value.storagePath,
                sha256: res.value.sha256,
                state: 'clean',
              };
            } else if (res.status === 'fulfilled' && !res.value.ok) {
              next[idx] = {
                ...current,
                state: res.value.code === 'DIRTY' ? 'dirty' : 'error',
                error: res.value.message,
              };
            } else {
              next[idx] = {
                ...current,
                state: 'error',
                error: "Échec de l'upload. Réessaie.",
              };
            }
          });
          return next;
        });
      }

      return {
        accepted: accepted.length,
        capRejected,
        oversizeRejected: oversized.length,
      };
    },
    [items.length],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const setInitial = useCallback((preloaded: readonly UploadedAttachment[]) => {
    setItems(preloaded);
  }, []);

  const totalBytes = items.reduce((sum, x) => sum + x.sizeBytes, 0);

  return { items, addFiles, removeItem, clearAll, setInitial, totalBytes };
}
