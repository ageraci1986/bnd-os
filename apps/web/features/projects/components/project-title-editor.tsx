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

  useEffect(() => setDisplay(name), [name]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
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
    startTransition(async () => {
      const res = await renameProject({ projectId, name: next });
      if (res.ok) setDisplay(res.name);
      else {
        setDisplay(previous);
        notify({ tone: 'error', message: res.message });
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
            inputRef.current?.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
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
    <div className="group/title flex items-center gap-2">
      <Heading className={className}>
        {display}
        {suffix}
      </Heading>
      {canEdit ? (
        <button
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
