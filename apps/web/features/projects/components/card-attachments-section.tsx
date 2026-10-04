'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  CARD_ATTACHMENT_ACCEPT,
  CARD_ATTACHMENT_MAX_BYTES,
  attachmentKind,
  type AttachmentKind,
} from '@nexushub/domain';
import Image from 'next/image';
import { notify } from '@/features/shell/components/toaster';
import {
  deleteCardAttachment,
  finalizeCardAttachment,
  listCardAttachments,
  requestCardAttachmentUpload,
} from '../actions/card-attachments';
import type { CardAttachmentDTO } from '../lib/card-attachment-core';
import { uploadToSignedUrl } from '../lib/upload-to-signed-url';
import { forgetAttachmentUrl, getAttachmentThumbUrl } from '../lib/attachment-url-cache';
import { downloadCardAttachment } from '../lib/attachment-download';
import {
  attachmentRejectionMessage,
  formatAttachmentDate,
  formatAttachmentSize,
  resolveUploadContentType,
} from '../lib/attachment-format';
import { AttachmentViewer } from './attachment-viewer';
import { CARD_UPDATED_EVENT, type CardUpdatedEventDetail } from './card-modal-controller';

export interface CardAttachmentsSectionProps {
  readonly cardId: string;
  readonly initial: readonly CardAttachmentDTO[];
  /** false → zone d'ajout masquée (Viewer / modal en lecture seule). */
  readonly canUpload: boolean;
}

interface UploadRow {
  readonly localId: number;
  readonly filename: string;
  readonly progress: number;
}

const MAX_PARALLEL_UPLOADS = 3;
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 2 * 60 * 1000;

/**
 * Section « Pièces jointes » du modal de carte (lot C, spec §5).
 *
 * Flux d'ajout par fichier (3 en parallèle max) : contrôle local (liste
 * blanche, 50 Mo) → `requestCardAttachmentUpload` (URL signée) → PUT direct
 * vers Storage avec progression → `finalizeCardAttachment` (déclenche le
 * scan). La PJ reste « Analyse en cours… » tant que le scan n'a pas tranché :
 * polling `listCardAttachments` toutes les 3 s, arrêté à 2 min ou au
 * démontage ; au-delà de 2 min, un bouton « Actualiser » relance le polling.
 * Une de MES PJ `pending` qui disparaît a été rejetée : toast explicite
 * selon la catégorie renvoyée par le serveur (`recentlyRejected`).
 */
export function CardAttachmentsSection({
  cardId,
  initial,
  canUpload,
}: CardAttachmentsSectionProps) {
  const [items, setItems] = useState<readonly CardAttachmentDTO[]>(initial);
  const [uploads, setUploads] = useState<readonly UploadRow[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  /** Polling abandonné après 2 min alors que des PJ restent en analyse. */
  const [pollExpired, setPollExpired] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const titleId = useId();

  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Rows created server-side but whose bytes are still in flight. */
  const uploadingIds = useRef(new Set<string>());
  /** Deleted locally — ignored if a stale poll response still lists them. */
  const deletedIds = useRef(new Set<string>());
  const nextLocalId = useRef(0);

  // ---- Kanban badge: broadcast the clean count when it changes ----------
  const cleanCount = items.filter((a) => a.scanStatus === 'clean').length;
  const lastCount = useRef(cleanCount);
  useEffect(() => {
    if (lastCount.current === cleanCount) return;
    lastCount.current = cleanCount;
    const detail: CardUpdatedEventDetail = { id: cardId, attachmentCount: cleanCount };
    window.dispatchEvent(new CustomEvent(CARD_UPDATED_EVENT, { detail }));
  }, [cardId, cleanCount]);

  // ---- Polling while something is pending -------------------------------
  const hasPending = items.some((a) => a.scanStatus === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    const startedAt = Date.now();
    let stopped = false;
    let inflight = false;
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        window.clearInterval(timer);
        setPollExpired(true);
        return;
      }
      if (inflight) return;
      inflight = true;
      const known = new Set(itemsRef.current.map((a) => a.id));
      listCardAttachments({ cardId })
        .then((res) => {
          if (stopped || !res.ok) return;
          const server = res.attachments.filter(
            (a) => !uploadingIds.current.has(a.id) && !deletedIds.current.has(a.id),
          );
          const serverIds = new Set(server.map((a) => a.id));
          const rejected = new Map(res.recentlyRejected.map((r) => [r.id, r.rejectReason]));
          const prev = itemsRef.current;
          for (const a of prev) {
            if (a.scanStatus !== 'pending' || !known.has(a.id) || serverIds.has(a.id)) continue;
            // Raison connue = MA PJ rejetée. Sinon (PJ d'un autre supprimée
            // ou rejetée), disparition silencieuse.
            const reason = rejected.get(a.id);
            if (reason) {
              notify({
                tone: 'error',
                message: `« ${a.filename} » : ${attachmentRejectionMessage(reason)}`,
              });
            }
          }
          // Keep rows added locally after this request started.
          const addedMeanwhile = prev.filter((a) => !known.has(a.id) && !serverIds.has(a.id));
          setItems([...server, ...addedMeanwhile]);
        })
        .catch(() => undefined)
        .finally(() => {
          inflight = false;
        });
    }, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [cardId, hasPending, pollEpoch]);

  // ---- Upload -----------------------------------------------------------
  const removeUpload = (localId: number) =>
    setUploads((prev) => prev.filter((u) => u.localId !== localId));

  const uploadOne = useCallback(
    async (file: File, contentType: string) => {
      const localId = nextLocalId.current++;
      setUploads((prev) => [...prev, { localId, filename: file.name, progress: 0 }]);

      const req = await requestCardAttachmentUpload({
        cardId,
        filename: file.name,
        contentType,
        sizeBytes: file.size,
      }).catch(() => null);
      if (!req || !req.ok) {
        notify({ tone: 'error', message: req?.message ?? "Impossible de préparer l'envoi." });
        removeUpload(localId);
        return;
      }
      const { attachmentId } = req;
      uploadingIds.current.add(attachmentId);

      try {
        await uploadToSignedUrl({
          signedUrl: req.signedUrl,
          file,
          contentType,
          onProgress: (fraction) =>
            setUploads((prev) =>
              prev.map((u) => (u.localId === localId ? { ...u, progress: fraction } : u)),
            ),
        });
      } catch {
        uploadingIds.current.delete(attachmentId);
        removeUpload(localId);
        notify({ tone: 'error', message: `Échec de l’envoi de « ${file.name} ». Réessaie.` });
        // Best effort: drop the orphan `pending` row (the cleanup cron
        // catches it otherwise).
        void deleteCardAttachment({ attachmentId }).catch(() => undefined);
        return;
      }

      const fin = await finalizeCardAttachment({ attachmentId }).catch(() => null);
      uploadingIds.current.delete(attachmentId);
      removeUpload(localId);
      if (!fin || !fin.ok) {
        notify({ tone: 'error', message: fin?.message ?? `Échec de l’envoi de « ${file.name} ».` });
        return;
      }
      const pending: CardAttachmentDTO = {
        id: attachmentId,
        filename: file.name,
        contentType,
        sizeBytes: file.size,
        scanStatus: 'pending',
        uploaderName: null,
        createdAt: new Date().toISOString(),
        canDelete: true,
      };
      setItems((prev) => (prev.some((a) => a.id === attachmentId) ? prev : [...prev, pending]));
      // Restart the 2-min polling window for this new file.
      setPollExpired(false);
      setPollEpoch((n) => n + 1);
    },
    [cardId],
  );

  const addFiles = useCallback(
    async (list: FileList | readonly File[]) => {
      const accepted: { file: File; contentType: string }[] = [];
      for (const file of Array.from(list)) {
        const contentType = resolveUploadContentType(file);
        if (!contentType) {
          notify({ tone: 'error', message: `Type de fichier non autorisé : « ${file.name} ».` });
        } else if (file.size > CARD_ATTACHMENT_MAX_BYTES) {
          notify({
            tone: 'error',
            message: `« ${file.name} » dépasse la taille maximale (50 Mo).`,
          });
        } else if (file.size === 0) {
          notify({ tone: 'error', message: `« ${file.name} » est vide.` });
        } else {
          accepted.push({ file, contentType });
        }
      }
      const queue = [...accepted];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          await uploadOne(next.file, next.contentType);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MAX_PARALLEL_UPLOADS, queue.length) }, worker),
      );
    },
    [uploadOne],
  );

  // ---- Delete -----------------------------------------------------------
  const remove = async (a: CardAttachmentDTO) => {
    if (!window.confirm(`Supprimer « ${a.filename} » ?`)) return;
    const res = await deleteCardAttachment({ attachmentId: a.id }).catch(() => null);
    if (!res || !res.ok) {
      notify({ tone: 'error', message: res?.message ?? 'Suppression impossible. Réessaie.' });
      return;
    }
    deletedIds.current.add(a.id);
    forgetAttachmentUrl(a.id);
    setItems((prev) => prev.filter((x) => x.id !== a.id));
    if (viewerId === a.id) setViewerId(null);
  };

  // ---- Viewer -----------------------------------------------------------
  const viewable = items.filter((a) => a.scanStatus === 'clean');
  const viewerIndex = viewerId ? viewable.findIndex((a) => a.id === viewerId) : -1;

  const total = items.length;

  return (
    <section className="nx-attachments" aria-labelledby={titleId}>
      <h3 id={titleId} className="nx-attachments__title">
        Pièces jointes
        {total > 0 ? <span className="nx-attachments__count">{total}</span> : null}
      </h3>

      {canUpload ? (
        <div
          className={['nx-attachments__drop', dragging && 'nx-attachments__drop--active']
            .filter(Boolean)
            .join(' ')}
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={(e) => {
            const to = e.relatedTarget;
            if (to instanceof Node && e.currentTarget.contains(to)) return;
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
          }}
        >
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-attachments__add"
            onClick={() => inputRef.current?.click()}
            aria-describedby={hintId}
          >
            <PaperclipIcon />
            Ajouter des fichiers
          </button>
          <p id={hintId} className="nx-attachments__hint">
            ou glissez-les ici · Images, vidéos, PDF, Office, txt, csv, zip — 50 Mo max
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={CARD_ATTACHMENT_ACCEPT}
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
              // Allow re-picking the same file afterwards.
              e.currentTarget.value = '';
              if (files.length > 0) void addFiles(files);
            }}
          />
        </div>
      ) : null}

      {pollExpired && hasPending ? (
        <p className="nx-attachments__hint" role="status">
          L’analyse prend plus de temps que prévu.{' '}
          <button
            type="button"
            className="nx-btn nx-btn--ghost"
            onClick={() => {
              setPollExpired(false);
              setPollEpoch((n) => n + 1);
            }}
          >
            Actualiser
          </button>
        </p>
      ) : null}

      {total === 0 && uploads.length === 0 ? (
        <p className="nx-attachments__empty">Aucune pièce jointe.</p>
      ) : (
        <ul className="nx-attachments__list">
          {items.map((a) => (
            <AttachmentRow
              key={a.id}
              cardId={cardId}
              attachment={a}
              onOpen={() => setViewerId(a.id)}
              onDelete={() => void remove(a)}
            />
          ))}
          {uploads.map((u) => (
            <UploadingRow key={`upload-${u.localId}`} row={u} />
          ))}
        </ul>
      )}

      {viewerIndex >= 0 ? (
        <AttachmentViewer
          items={viewable}
          index={viewerIndex}
          onIndexChange={(i) => setViewerId(viewable[i]?.id ?? null)}
          onClose={() => setViewerId(null)}
          onDownload={(a) => void downloadCardAttachment(a.id)}
        />
      ) : null}
    </section>
  );
}

function AttachmentRow({
  cardId,
  attachment: a,
  onOpen,
  onDelete,
}: {
  readonly cardId: string;
  readonly attachment: CardAttachmentDTO;
  readonly onOpen: () => void;
  readonly onDelete: () => void;
}) {
  const clean = a.scanStatus === 'clean';
  const kind = attachmentKind(a.contentType);
  const meta = [
    formatAttachmentSize(a.sizeBytes),
    a.uploaderName,
    formatAttachmentDate(a.createdAt),
  ].filter((part): part is string => Boolean(part));

  return (
    <li className="nx-attachment">
      {clean ? (
        <button
          type="button"
          className="nx-attachment__preview"
          onClick={onOpen}
          aria-label={`Ouvrir ${a.filename}`}
        >
          <AttachmentThumb cardId={cardId} attachment={a} kind={kind} />
        </button>
      ) : (
        <div className="nx-attachment__preview" aria-hidden="true">
          <KindIcon kind={kind} />
        </div>
      )}
      <div className="nx-attachment__meta">
        <span className="nx-attachment__name" title={a.filename}>
          {a.filename}
        </span>
        <span className="nx-attachment__sub">{meta.join(' · ')}</span>
        {a.scanStatus === 'pending' ? (
          <span className="nx-attachment__status" role="status">
            Analyse en cours…
          </span>
        ) : null}
      </div>
      <div className="nx-attachment__actions">
        {clean ? (
          <button
            type="button"
            className="nx-attachment__action"
            onClick={() => void downloadCardAttachment(a.id)}
            aria-label={`Télécharger ${a.filename}`}
            title="Télécharger"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
            </svg>
          </button>
        ) : null}
        {a.canDelete ? (
          <button
            type="button"
            className="nx-attachment__action nx-attachment__action--danger"
            onClick={onDelete}
            aria-label={`Supprimer ${a.filename}`}
            title="Supprimer"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
            </svg>
          </button>
        ) : null}
      </div>
    </li>
  );
}

function UploadingRow({ row }: { readonly row: UploadRow }) {
  const pct = Math.round(row.progress * 100);
  return (
    <li className="nx-attachment nx-attachment--uploading">
      <div className="nx-attachment__preview" aria-hidden="true">
        <PaperclipIcon />
      </div>
      <div className="nx-attachment__meta">
        <span className="nx-attachment__name" title={row.filename}>
          {row.filename}
        </span>
        <div
          className="nx-progress"
          role="progressbar"
          aria-label={`Envoi de ${row.filename}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="nx-progress__bar" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </li>
  );
}

/**
 * Image vignette (clean images only), fetched when scrolled into view. Les
 * URL viennent d'un lot signé par carte (`getAttachmentThumbUrl`) : un seul
 * appel serveur pour toutes les vignettes visibles.
 */
function AttachmentThumb({
  cardId,
  attachment,
  kind,
}: {
  readonly cardId: string;
  readonly attachment: CardAttachmentDTO;
  readonly kind: AttachmentKind;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const retried = useRef(false);
  const isImage = kind === 'image';

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    const load = () => {
      void getAttachmentThumbUrl(cardId, attachment.id).then((url) => {
        if (!cancelled && url) setSrc(url);
      });
    };
    const el = ref.current;
    if (typeof IntersectionObserver === 'undefined' || !el) {
      load();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        load();
      }
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [cardId, attachment.id, isImage]);

  return (
    <span ref={ref} className="nx-attachment__thumb">
      {isImage && src ? (
        // `unoptimized`: short-lived signed URL served as-is (see viewer).
        <Image
          src={src}
          alt=""
          width={48}
          height={48}
          unoptimized
          loading="lazy"
          onError={() => {
            // Expired / revoked URL: refresh once.
            if (retried.current) return;
            retried.current = true;
            void getAttachmentThumbUrl(cardId, attachment.id, { force: true }).then((url) => {
              if (url) setSrc(url);
            });
          }}
        />
      ) : (
        <KindIcon kind={kind} />
      )}
    </span>
  );
}

function KindIcon({ kind }: { readonly kind: AttachmentKind }) {
  const paths: Record<AttachmentKind, string> = {
    image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.2a.7.7 0 1 0 0-.1',
    video: 'M2.5 4h8v8h-8zM10.5 7l3-2v6l-3-2',
    pdf: 'M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12M6 8.5h4M6 11h4',
    file: 'M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12',
  };
  return (
    <svg
      className="nx-attachment__icon"
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 7.5 8.1 12.9a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3L6.6 11.4a1.1 1.1 0 0 1-1.5-1.5l5-5" />
    </svg>
  );
}
