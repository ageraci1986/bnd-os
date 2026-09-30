'use client';
import { useState } from 'react';
import { CalendarItem } from './calendar-item';
import type { CalendarCardItem } from './calendar-view';

export interface CalendarDayOverflowProps {
  /** Cards beyond the ones always shown for the day. */
  readonly cards: readonly CalendarCardItem[];
  readonly clientSlug: string | null;
}

/**
 * "+N autres" toggle for a busy calendar day. Expanded, the extra cards
 * render first and the "Réduire" toggle moves to the end of the list.
 */
export function CalendarDayOverflow({ cards, clientSlug }: CalendarDayOverflowProps) {
  const [open, setOpen] = useState(false);
  const count = cards.length;

  return (
    <>
      {open
        ? cards.map((card) => <CalendarItem key={card.id} card={card} clientSlug={clientSlug} />)
        : null}
      <button
        type="button"
        className="cal-more"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Réduire' : `+${count} autre${count > 1 ? 's' : ''}`}
      </button>
    </>
  );
}
