'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { attachmentKind } from '@nexushub/domain';
import type { CardAttachmentDTO } from '../lib/card-attachment-core';
import { getAttachmentInlineUrl } from '../lib/attachment-url-cache';

export interface AttachmentViewerProps {
  /** PJ consultables (`clean`) — la navigation ←/→ boucle sur cette liste. */
  readonly items: readonly CardAttachmentDTO[];
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
  readonly onDownload: (item: CardAttachmentDTO) => void;
}

/**
 * Éléments du piège à focus. L'iframe PDF en est EXCLUE (et `tabIndex=-1`) :
 * une fois le focus dans le lecteur PDF du navigateur, les touches n'arrivent
 * plus à notre document — Échap ne fermerait plus la visionneuse au clavier.
 */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, video[controls], [tabindex]:not([tabindex="-1"])';

/**
 * Visionneuse plein écran des PJ (lot C, spec §5). Dialog modal accessible :
 * focus initial sur « Fermer », focus piégé, Échap ferme, ←/→ naviguent ;
 * le focus revient à l'élément déclencheur à la fermeture.
 *
 * Les touches sont écoutées sur `document` en phase de CAPTURE, donc avant
 * le listener `keydown` (phase de bouillonnement) que `card-modal.tsx` pose
 * sur `window` pour fermer le modal de carte sur Échap. Échap et ←/→ sont
 * stoppés (`stopPropagation`) : sans cela, Échap fermerait aussi le modal de
 * carte sous-jacent. Tab n'est pas stoppé (seulement bouclé dans le piège).
 */
export function AttachmentViewer({
  items,
  index,
  onIndexChange,
  onClose,
  onDownload,
}: AttachmentViewerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const item = items[index];
  const count = items.length;

  // Latest callbacks without re-binding the key listener on every render.
  const latest = useRef({ index, count, onIndexChange, onClose });
  latest.current = { index, count, onIndexChange, onClose };

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { index: i, count: n, onIndexChange: go, onClose: close } = latest.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      const target = e.target instanceof HTMLElement ? e.target : null;
      // ←/→ restent aux contrôles natifs (vidéo : avance/recul).
      const nativeArrows = target?.closest('video, input, textarea, select') != null;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !nativeArrows && n > 1) {
        e.preventDefault();
        e.stopPropagation();
        go(e.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n);
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (!first || !last) return;
        const active = document.activeElement;
        const inside = active instanceof Node && dialogRef.current.contains(active);
        if (e.shiftKey && (active === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  if (!item || typeof document === 'undefined') return null;

  return createPortal(
    <div className="nx-viewer">
      <div className="nx-viewer__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="nx-viewer__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={item.filename}
      >
        <header className="nx-viewer__bar">
          <span className="nx-viewer__title" title={item.filename}>
            {item.filename}
          </span>
          {count > 1 ? (
            <span className="nx-viewer__counter" aria-live="polite">
              {index + 1} / {count}
            </span>
          ) : null}
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-viewer__action"
            onClick={() => onDownload(item)}
          >
            Télécharger
          </button>
          <button
            ref={closeRef}
            type="button"
            className="nx-viewer__close"
            onClick={onClose}
            aria-label="Fermer la visionneuse"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>
        <div className="nx-viewer__stage">
          {count > 1 ? (
            <button
              type="button"
              className="nx-viewer__nav nx-viewer__nav--prev"
              onClick={() => onIndexChange((index - 1 + count) % count)}
              aria-label="Pièce jointe précédente"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18" fill="none">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
          ) : null}
          <ViewerContent key={item.id} item={item} onDownload={onDownload} />
          {count > 1 ? (
            <button
              type="button"
              className="nx-viewer__nav nx-viewer__nav--next"
              onClick={() => onIndexChange((index + 1) % count)}
              aria-label="Pièce jointe suivante"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18" fill="none">
                <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly src: string }
  | { readonly status: 'error' };

function ViewerContent({
  item,
  onDownload,
}: {
  readonly item: CardAttachmentDTO;
  readonly onDownload: (item: CardAttachmentDTO) => void;
}) {
  const kind = attachmentKind(item.contentType);
  const previewable = kind !== 'file';
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!previewable) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    const ctrl = new AbortController();

    (async () => {
      const url = await getAttachmentInlineUrl(item.id);
      if (cancelled) return;
      if (!url) {
        setState({ status: 'error' });
        return;
      }
      if (kind !== 'pdf') {
        setState({ status: 'ready', src: url });
        return;
      }
      // PDF : servi depuis un blob: local (frame-src 'self' blob:) plutôt
      // que d'autoriser l'hôte Storage dans frame-src. Le blob est re-typé
      // `application/pdf` : une URL blob: hérite de NOTRE origine, on ne
      // laisse donc jamais le contenu dicter son type (pas de HTML exécuté).
      const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.blob();
      if (cancelled) return;
      blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      setState({ status: 'ready', src: blobUrl });
    })().catch(() => {
      if (!cancelled) setState({ status: 'error' });
    });

    return () => {
      cancelled = true;
      ctrl.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [item.id, kind, previewable]);

  if (!previewable || state.status === 'error') {
    return (
      <div className="nx-viewer__fallback">
        <p>
          {previewable
            ? 'Impossible de charger l’aperçu.'
            : 'Aperçu indisponible pour ce type de fichier.'}
        </p>
        <button type="button" className="nx-btn nx-btn--primary" onClick={() => onDownload(item)}>
          Télécharger le fichier
        </button>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="nx-viewer__fallback" role="status">
        Chargement de l’aperçu…
      </div>
    );
  }

  if (kind === 'image') {
    // `unoptimized`: short-lived signed Storage URL, served as-is (the
    // optimizer would proxy and cache it past its 5-min expiry).
    return (
      <Image
        className="nx-viewer__image"
        src={state.src}
        alt={item.filename}
        fill
        unoptimized
        sizes="96vw"
      />
    );
  }
  if (kind === 'video') {
    return (
      <video
        className="nx-viewer__media"
        src={state.src}
        controls
        preload="metadata"
        aria-label={item.filename}
      />
    );
  }
  // Pas d'attribut `sandbox` : le lecteur PDF intégré de Chrome (et pdf.js
  // de Firefox) refuse de s'afficher dans une iframe sandboxée. Le risque
  // est couvert par le re-typage `application/pdf` du blob (ci-dessus) et
  // le contrôle magic bytes du scan.
  // `tabIndex={-1}` : hors de l'ordre de tabulation (voir FOCUSABLE) — le
  // lecteur PDF capturerait le clavier et Échap ne fermerait plus.
  return (
    <iframe className="nx-viewer__frame" src={state.src} title={item.filename} tabIndex={-1} />
  );
}
