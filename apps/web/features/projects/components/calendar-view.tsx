import Link from 'next/link';
import {
  buildMonthGrid,
  formatYearMonth,
  nextYearMonth,
  previousYearMonth,
} from '@nexushub/domain';

const MONTHS_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export interface CalendarCardItem {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly shortRef: number;
  readonly isoDate: string;
  readonly clientColorToken: string;
  readonly columnIsBlocked: boolean;
}

export interface CalendarLegendItem {
  readonly name: string;
  readonly colorToken: string;
}

export interface CalendarViewProps {
  readonly year: number;
  readonly month1: number;
  readonly cards: readonly CalendarCardItem[];
  /** Used to build the month-nav URLs; the route owns the path. */
  readonly basePath: string;
  /** Preserved across month navigation so the global filter follows. */
  readonly clientSlug: string | null;
  /** Clients to display in the legend (only those actually drawn on the grid). */
  readonly legend: readonly CalendarLegendItem[];
}

function buildHref(
  basePath: string,
  year: number,
  month1: number,
  clientSlug: string | null,
): string {
  const params = new URLSearchParams();
  params.set('month', formatYearMonth(year, month1));
  if (clientSlug) params.set('client', clientSlug);
  return `${basePath}?${params.toString()}`;
}

export function CalendarView({
  year,
  month1,
  cards,
  basePath,
  clientSlug,
  legend,
}: CalendarViewProps) {
  const prev = previousYearMonth(year, month1);
  const next = nextYearMonth(year, month1);
  const todayIso = new Date().toISOString().slice(0, 10);
  const today = new Date();
  const todayHref = buildHref(
    basePath,
    today.getUTCFullYear(),
    today.getUTCMonth() + 1,
    clientSlug,
  );

  const cells = buildMonthGrid(year, month1);

  // Index cards by ISO day for O(1) lookup.
  const byDay = new Map<string, CalendarCardItem[]>();
  for (const card of cards) {
    const list = byDay.get(card.isoDate);
    if (list) list.push(card);
    else byDay.set(card.isoDate, [card]);
  }

  return (
    <>
      <div className="cal-toolbar">
        <div className="cal-nav">
          <Link
            href={buildHref(basePath, prev.year, prev.month1, clientSlug)}
            aria-label="Mois précédent"
            className="cal-nav-btn"
          >
            ‹
          </Link>
          <div className="cal-month">
            {MONTHS_FR[month1 - 1]} <span>{year}</span>
          </div>
          <Link
            href={buildHref(basePath, next.year, next.month1, clientSlug)}
            aria-label="Mois suivant"
            className="cal-nav-btn"
          >
            ›
          </Link>
          <Link href={todayHref} className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}>
            Aujourd'hui
          </Link>
        </div>
        <div className="cal-legend">
          {legend.map((l) => (
            <LegendItem key={l.name} token={l.colorToken} label={l.name} />
          ))}
          {cards.some((c) => c.columnIsBlocked) ? (
            <span className="cal-legend-item" style={{ color: 'var(--color-danger)' }}>
              <span
                className="cal-legend-dot"
                style={{ background: 'transparent', border: '2px solid var(--color-danger)' }}
              />
              Bloqué
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="cal-grid"
        role="grid"
        aria-label={`Calendrier ${MONTHS_FR[month1 - 1]} ${year}`}
      >
        {DOW.map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
        {cells.map((cell) => {
          const dayCards = byDay.get(cell.isoDate) ?? [];
          const isToday = cell.isoDate === todayIso;
          const className = ['cal-day', !cell.inMonth && 'muted', isToday && 'today']
            .filter(Boolean)
            .join(' ');
          const visible = dayCards.slice(0, 3);
          const hidden = dayCards.length - visible.length;
          return (
            <div key={cell.isoDate} className={className} role="gridcell">
              <div className="cal-date">{cell.date.getUTCDate()}</div>
              <div className="cal-items">
                {visible.map((card) => (
                  <CalendarItem key={card.id} card={card} />
                ))}
                {hidden > 0 ? (
                  <span className="cal-more">
                    +{hidden} autre{hidden > 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CalendarItem({ card }: { card: CalendarCardItem }) {
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
      href={`/projects/${card.projectId}?card=${card.id}`}
      className={className}
      title={`#${String(card.shortRef).padStart(3, '0')} · ${card.title}`}
    >
      {card.title}
    </Link>
  );
}

function LegendItem({ token, label }: { token: string; label: string }) {
  return (
    <span className="cal-legend-item">
      <span className="cal-legend-dot" style={{ background: `var(--${token})` }} />
      {label}
    </span>
  );
}
