'use client';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { PencilIcon } from '@/features/shell/components/icons';
import { notify } from '@/features/shell/components/toaster';
import { renameProject } from '../actions/rename-project';

export interface ProjectTitleEditorProps {
  readonly projectId: string;
  readonly name: string;
  readonly canEdit: boolean;
  /** `h1` dans le header projet, `h2` sur les cartes de /projects. */
  readonly as?: 'h1' | 'h2';
  readonly className?: string;
  /** Rendu après le titre dans le heading (ex. « · calendrier »). */
  readonly suffix?: ReactNode;
}

/**
 * Titre de projet éditable inline : crayon (survol / focus) → champ ;
 * Entrée ou blur enregistre, Échap annule. Optimiste avec rollback + toast.
 * Sur les cartes /projects le parent est `pointer-events-none` (stretched
 * link) : seuls le crayon et le champ réactivent les événements.
 */
export function ProjectTitleEditor({
  projectId,
  name,
  canEdit,
  as: Heading = 'h1',
  className,
  suffix,
}: ProjectTitleEditorProps) {
  const [display, setDisplay] = useState(name);
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pencilRef = useRef<HTMLButtonElement | null>(null);
  // Entrée/Échap doivent rendre le focus au crayon (WCAG 2.4.3) ; un blur
  // causé par un clic ailleurs laisse le focus suivre ce clic naturellement.
  const endedViaKeyboardRef = useRef(false);
  // Ignore la réponse d'une requête de renommage qui n'est plus la dernière
  // (double Entrée rapide) pour éviter un flicker display → ancien → nouveau.
  const requestIdRef = useRef(0);

  useEffect(() => setDisplay(name), [name]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (endedViaKeyboardRef.current) {
      endedViaKeyboardRef.current = false;
      pencilRef.current?.focus();
    }
  }, [editing]);

  const begin = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cancelledRef.current = false;
    setDraft(display);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) return;
    const next = draft.trim();
    if (next.length === 0 || next === display) return;
    const previous = display;
    setDisplay(next);
    const requestId = ++requestIdRef.current;
    startTransition(async () => {
      try {
        const res = await renameProject({ projectId, name: next });
        if (requestIdRef.current !== requestId) return;
        if (res.ok) setDisplay(res.name);
        else {
          setDisplay(previous);
          notify({ tone: 'error', message: res.message });
        }
      } catch {
        if (requestIdRef.current !== requestId) return;
        setDisplay(previous);
        notify({ tone: 'error', message: 'Renommage impossible. Réessayez.' });
      }
    });
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label="Nom du projet"
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            endedViaKeyboardRef.current = true;
            inputRef.current?.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            endedViaKeyboardRef.current = true;
            cancelledRef.current = true;
            setEditing(false);
          }
        }}
        onBlur={commit}
        className={`pointer-events-auto relative z-[2] w-full rounded-md border border-[color:var(--color-accent-primary)] bg-[color:var(--color-bg-card)] px-2 py-0.5 font-extrabold tracking-tight text-[color:var(--color-text-main)] outline-none ${className ?? ''}`}
      />
    );
  }

  return (
    <div className="group/title flex min-w-0 items-center gap-2">
      <Heading className={['min-w-0 break-words', className].filter(Boolean).join(' ')}>
        {display}
        {suffix}
      </Heading>
      {canEdit ? (
        <button
          ref={pencilRef}
          type="button"
          onClick={begin}
          aria-label="Renommer le projet"
          title="Renommer"
          className="pointer-events-auto relative z-[2] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[color:var(--color-text-muted)] opacity-0 transition hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-text-main)] focus-visible:opacity-100 group-hover/title:opacity-100 group-hover:opacity-100"
        >
          <PencilIcon width={14} height={14} style={{ width: 14, height: 14, display: 'block' }} />
        </button>
      ) : null}
    </div>
  );
}
