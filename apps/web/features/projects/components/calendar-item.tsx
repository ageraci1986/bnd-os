import Link from 'next/link';
import { clientColorCss } from '@nexushub/domain';
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
  const color = clientColorCss(card.clientColorToken);
  const className = ['cal-item', card.columnIsBlocked && 'blocked', card.isDone && 'done']
    .filter(Boolean)
    .join(' ');
  // Bloqué garde son style danger (classe) : pas de couleur client inline.
  const style = card.columnIsBlocked
    ? undefined
    : { background: `color-mix(in srgb, ${color} 12%, transparent)`, color };

  return (
    <Link
      href={buildHrefWithClient(`/projects/${card.projectId}`, `card=${card.id}`, clientSlug)}
      className={className}
      style={style}
      title={`#${String(card.shortRef).padStart(3, '0')} · ${card.title}${card.isDone ? ' (terminée)' : ''}`}
    >
      {card.title}
      {card.isDone ? <span className="sr-only"> (terminée)</span> : null}
    </Link>
  );
}
