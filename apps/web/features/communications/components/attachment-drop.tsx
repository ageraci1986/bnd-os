'use client';
import { useCallback, useRef, useState } from 'react';
import type { UploadedAttachment } from '../hooks/use-attachment-uploader';
import { MAX_ATTACHMENTS } from '../hooks/use-attachment-uploader';
import { formatBytes, iconFor } from '../lib/attachment-format';

/** Spec §5.1: 25 MB total per mail (same figure as the per-file cap — coincidence, not a bug). */
const MAX_MAIL_BYTES = 25 * 1024 * 1024;

interface Props {
  readonly items: readonly UploadedAttachment[];
  readonly totalBytes: number;
  readonly onDrop: (files: readonly File[]) => Promise<void>;
  readonly onRemove: (id: string) => void;
  readonly disabled?: boolean;
}

function StatusGlyph({ item }: { readonly item: UploadedAttachment }) {
  switch (item.state) {
    case 'uploading':
      return (
        <span
          className="ml-2 inline-flex items-center gap-1 text-[color:var(--color-text-muted)]"
          aria-hidden
        >
          <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Analyse antivirus…
        </span>
      );
    case 'clean':
      return (
        <span className="ml-2 text-[color:var(--color-success)]" aria-hidden>
          ✓ Prêt
        </span>
      );
    case 'dirty':
      return (
        <span className="ml-2 text-[color:var(--color-danger)]" aria-hidden>
          ⚠ Bloqué par l'antivirus
        </span>
      );
    case 'error':
      return (
        <span className="ml-2 text-[color:var(--color-danger)]" aria-hidden>
          ⚠ {item.error ?? 'Erreur'}
        </span>
      );
    default:
      return null;
  }
}

function statusText(item: UploadedAttachment): string {
  switch (item.state) {
    case 'uploading':
      return 'Analyse antivirus en cours';
    case 'clean':
      return 'Prêt';
    case 'dirty':
      return "Bloqué par l'antivirus";
    case 'error':
      return item.error ?? 'Erreur';
    default:
      return '';
  }
}

export function AttachmentDrop({ items, totalBytes, onDrop, onRemove, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const atCap = items.length >= MAX_ATTACHMENTS;
  const dropDisabled = disabled || atCap;

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      void onDrop(Array.from(fileList));
    },
    [onDrop],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      if (dropDisabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles, dropDisabled],
  );

  return (
    <div className="mt-2">
      {items.length > 0 ? (
        <div
          className="mb-2 flex items-center justify-between text-xs text-[color:var(--color-text-muted)]"
          aria-live="polite"
        >
          <span>
            📎 Pièces jointes ({items.length} · {formatBytes(totalBytes)} / 25 MB)
          </span>
          {totalBytes > MAX_MAIL_BYTES ? (
            <span className="text-[color:var(--color-danger)]">⚠ Dépasse 25 MB</span>
          ) : null}
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-1">
          {items.map((it) => (
            <li
              key={it.id}
              className={`flex items-center justify-between rounded border px-2 py-1 text-xs ${
                it.state === 'dirty' || it.state === 'error'
                  ? 'border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)]'
                  : 'border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)]'
              }`}
            >
              <span className="flex-1 truncate">
                <span aria-hidden>{iconFor(it.contentType)}</span> {it.filename}{' '}
                <span className="text-[color:var(--color-text-muted)]">
                  ({formatBytes(it.sizeBytes)})
                </span>
                <StatusGlyph item={it} />
                <span className="sr-only"> — {statusText(it)}</span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(it.id)}
                className="ml-2 rounded px-1 text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-danger)]"
                aria-label={`Retirer ${it.filename}`}
              >
                {it.state === 'dirty' || it.state === 'error' ? 'Retirer' : '×'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!dropDisabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`block rounded border border-dashed px-3 py-4 text-center text-xs transition-colors focus-within:ring-2 focus-within:ring-[color:var(--color-accent-primary)] focus-within:ring-offset-2 ${
          dropDisabled
            ? 'cursor-not-allowed border-[color:var(--color-border-light)] text-[color:var(--color-text-ghost)] opacity-60'
            : isDragOver
              ? 'cursor-pointer border-[color:var(--color-accent-primary)] bg-[color:var(--color-bg-hover)] text-[color:var(--color-text-main)]'
              : 'cursor-pointer border-[color:var(--color-border-light)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)]'
        }`}
      >
        {atCap ? (
          'Limite de 20 pièces jointes atteinte.'
        ) : (
          <>
            Glisse tes fichiers ici, ou <span className="underline">choisis un fichier</span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={dropDisabled}
          className="sr-only"
          aria-label="Ajouter des pièces jointes"
          onChange={(e) => {
            handleFiles(e.target.files);
            // Reset so selecting the same file again re-fires onChange.
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}
