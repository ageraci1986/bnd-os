'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { CalendarIcon, KanbanIcon, ListIcon } from '@/features/shell/components/icons';

export interface ViewToggleProps {
  readonly projectId: string;
}

/**
 * 3-option pill switcher used in the project header to flip between
 * Kanban (default route), Liste, and Calendrier. Active state is
 * derived from the current pathname so the same component works on
 * every sub-route of /projects/[id].
 *
 * Filter params (q / col / cat / asg / tpl / due) and the global
 * ?client= follow the user across views. Per-view params (?month=,
 * ?card=, ?new=) are dropped on switch — they only make sense in the
 * view that produced them.
 */
const PRESERVED_PARAMS = ['q', 'col', 'cat', 'asg', 'tpl', 'due', 'client'] as const;

function buildSwitchQuery(current: URLSearchParams | null): string {
  if (!current) return '';
  const next = new URLSearchParams();
  for (const key of PRESERVED_PARAMS) {
    const v = current.get(key);
    if (v) next.set(key, v);
  }
  const s = next.toString();
  return s ? `?${s}` : '';
}

export function ViewToggle({ projectId }: ViewToggleProps) {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const base = `/projects/${projectId}`;
  const isList = pathname === `${base}/list`;
  const isCalendar = pathname === `${base}/calendar`;
  const isKanban = !isList && !isCalendar;
  const qs = buildSwitchQuery(params);

  return (
    <div className="view-toggle">
      <Link
        href={`${base}${qs}`}
        className={isKanban ? 'active' : ''}
        aria-current={isKanban ? 'page' : undefined}
      >
        <KanbanIcon /> Kanban
      </Link>
      <Link
        href={`${base}/list${qs}`}
        className={isList ? 'active' : ''}
        aria-current={isList ? 'page' : undefined}
      >
        <ListIcon /> Liste
      </Link>
      <Link
        href={`${base}/calendar${qs}`}
        className={isCalendar ? 'active' : ''}
        aria-current={isCalendar ? 'page' : undefined}
      >
        <CalendarIcon /> Calendrier
      </Link>
    </div>
  );
}
