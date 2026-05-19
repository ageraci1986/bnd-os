'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uncompleteCard } from '../actions/uncomplete-card';
import { CARD_ADVANCED_EVENT, type CardAdvancedEventDetail } from './card-modal-controller';

export interface CardCompletedBadgeProps {
  readonly cardId: string;
  /** Read-only mode for Viewer or out-of-scope. Just shows the badge,
   *  no uncheck affordance. */
  readonly disabled?: boolean;
}

/**
 * Visual + click target for cards sitting in their project's last user
 * column. Renders as a filled check (same `nx-card-advance` footprint
 * as the advance checkbox upstream). Clicking it asks the server to
 * move the card back to the previous user column, which clears the
 * `completed_at` snapshot via the DB trigger.
 */
export function CardCompletedBadge({ cardId, disabled }: CardCompletedBadgeProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled || pending) return;
    startTransition(async () => {
      const result = await uncompleteCard({ cardId });
      if (result.ok) {
        const detail: CardAdvancedEventDetail = {
          id: cardId,
          newColumnId: result.newColumnId,
        };
        window.dispatchEvent(new CustomEvent(CARD_ADVANCED_EVENT, { detail }));
        router.refresh();
      } else {
        window.alert(result.message);
      }
    });
  };

  // dnd-kit's PointerSensor uses pointerdown to start a drag; stop it
  // here so clicking the badge never starts a row drag in list view.
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={true}
      aria-label="Décocher · remet la carte dans la colonne précédente"
      title={disabled ? 'Carte terminée' : 'Décocher · remet la carte dans la colonne précédente'}
      disabled={disabled || pending}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      className="nx-card-advance"
      data-state="checked"
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
