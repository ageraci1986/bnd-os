import { z } from 'zod';
import { parseWidgetData } from './parse-widget-data';

/** Shape produite par le tool `get_today_overview` (read-tools.ts). Extras tolérés. */
const TodayOverviewSchema = z.object({
  blockedCards: z.number().int().nonnegative(),
  dueTodayCards: z.number().int().nonnegative(),
  unreadMails: z.number().int().nonnegative(),
  unreadNotifications: z.number().int().nonnegative(),
});

export interface KpiCardsProps {
  readonly data: unknown;
}

interface KpiTileProps {
  readonly label: string;
  readonly value: number;
  readonly danger?: boolean;
}

/** Tuile compacte calquée sur `.ap-kpi` du mockup assistant validé (2026-07-27). */
function KpiTile({ label, value, danger = false }: KpiTileProps) {
  return (
    <div className="flex-1 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-3 py-2.5 shadow-[var(--shadow-card)]">
      <p className="text-[9px] font-extrabold uppercase tracking-[0.5px] text-[color:var(--color-text-ghost)]">
        {label}
      </p>
      <p
        className="mt-0.5 text-[13px] font-bold"
        style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text-main)' }}
      >
        {value}
      </p>
    </div>
  );
}

/** Rangée de 4 tuiles KPI compactes pour `get_today_overview`. Parse KO → `null`. */
export function KpiCards({ data }: KpiCardsProps) {
  const parsed = parseWidgetData('get_today_overview', TodayOverviewSchema, data);
  if (parsed === null) return null;
  const { blockedCards, dueTodayCards, unreadMails, unreadNotifications } = parsed;

  return (
    <div className="flex w-full gap-2" data-testid="kpi-cards">
      <KpiTile label="Bloquées" value={blockedCards} danger={blockedCards > 0} />
      <KpiTile label="Dues aujourd'hui" value={dueTodayCards} />
      <KpiTile label="Mails non lus" value={unreadMails} />
      <KpiTile label="Notifications" value={unreadNotifications} />
    </div>
  );
}
