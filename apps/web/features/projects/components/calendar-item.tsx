import Link from 'next/link';
import { buildHrefWithClient } from '@/features/shell/lib/client-filter-url';
import type { CalendarCardItem } from './calendar-view';

/**
 * One card pill in a calendar day. Hook-free so both the server-rendered
 * grid and the client-side overflow toggle can render it.
 */
export function CalendarItem({
  card,
  clientSlug,
}: {
  card: CalendarCardItem;
  clientSlug: string | null;
}) {
  const colorClass =
    card.clientColorToken === 'c-acme'
      ? 'i-acme'
      : card.clientColorToken === 'c-tech'
        ? 'i-tech'
        : card.clientColorToken === 'c-nova'
          ? 'i-nova'
          : card.clientColorToken === 'c-lumen'
            ? 'i-lumen'
            : 'i-orbit';

  const className = ['cal-item', colorClass, card.columnIsBlocked && 'blocked']
    .filter(Boolean)
    .join(' ');

  return (
    <Link
      href={buildHrefWithClient(`/projects/${card.projectId}`, `card=${card.id}`, clientSlug)}
      className={className}
      title={`#${String(card.shortRef).padStart(3, '0')} · ${card.title}`}
    >
      {card.title}
    </Link>
  );
}
