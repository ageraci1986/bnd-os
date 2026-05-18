'use client';
import { useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleCardCompletion } from '../actions/toggle-card-completion';

export interface CardCompleteCheckboxProps {
  readonly cardId: string;
  /** ISO string when set, null when not yet completed. */
  readonly completedAt: string | null;
  /** Hide / disable for Viewer or out-of-scope states. */
  readonly disabled?: boolean;
}

/**
 * Todo-list-style toggle for cards already sitting in the last user
 * column. Distinct from `CardAdvanceCheckbox`: the latter advances to
 * the next column, this one just stamps `completedAt` so the list
 * view can render a strikethrough.
 *
 * Optimistic: the box flips immediately and snaps back if the server
 * rejects (e.g. card moved out of last column between renders).
 */
export function CardCompleteCheckbox({ cardId, completedAt, disabled }: CardCompleteCheckboxProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverCompleted, setServerCompleted] = useState<boolean>(completedAt !== null);
  const [optimisticCompleted, setOptimisticCompleted] = useOptimistic(serverCompleted);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled || pending) return;
    const next = !optimisticCompleted;
    startTransition(async () => {
      setOptimisticCompleted(next);
      const result = await toggleCardCompletion({ cardId, completed: next });
      if (result.ok) {
        setServerCompleted(result.completedAt !== null);
        router.refresh();
      } else {
        // Snap back; surfacing the message would need a toast wiring.
        setServerCompleted((prev) => prev);
      }
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={optimisticCompleted}
      aria-label={optimisticCompleted ? 'Décocher « terminé »' : 'Marquer comme terminé'}
      title={optimisticCompleted ? 'Décocher « terminé »' : 'Marquer comme terminé'}
      disabled={disabled || pending}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      className="nx-card-advance"
      data-state={optimisticCompleted ? 'checked' : 'idle'}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="3 8.5 6.5 12 13 4.5" />
      </svg>
    </button>
  );
}
