'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { skipCardToNextColumn } from '../actions/skip-card-to-next-column';
import { CARD_ADVANCED_EVENT, type CardAdvancedEventDetail } from './card-modal-controller';

export interface CardAdvanceCheckboxProps {
  readonly cardId: string;
  /** Disabled when the card is in the last user column or in "Bloqué". */
  readonly disabled?: boolean;
}

/**
 * Compact checkbox at the top-left of a card. Clicking it advances the
 * card to the next user column — equivalent to checking every step item
 * at once. The server is the source of truth (skipCardToNextColumn);
 * we dispatch CARD_ADVANCED_EVENT so view-level components (kanban
 * board, list view) can move the row optimistically.
 */
export function CardAdvanceCheckbox({ cardId, disabled }: CardAdvanceCheckboxProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled || pending || done) return;

    setDone(true);
    startTransition(async () => {
      const result = await skipCardToNextColumn({ cardId });
      if (result.ok && result.moved) {
        const detail: CardAdvancedEventDetail = {
          id: cardId,
          newColumnId: result.newColumnId,
        };
        window.dispatchEvent(new CustomEvent(CARD_ADVANCED_EVENT, { detail }));
        router.refresh();
      } else {
        setDone(false);
      }
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // dnd-kit's PointerSensor uses pointerdown to start a drag; stop it
    // here so clicking the checkbox never initiates a drag on the card.
    e.stopPropagation();
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label="Faire avancer la carte vers la colonne suivante"
      title={
        disabled
          ? 'Aucune colonne suivante'
          : 'Marquer comme terminé · déplace vers la colonne suivante'
      }
      disabled={disabled || pending || done}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      className="nx-card-advance"
      data-state={done ? 'checked' : 'idle'}
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
