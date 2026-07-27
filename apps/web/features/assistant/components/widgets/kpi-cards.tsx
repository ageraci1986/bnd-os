import { z } from 'zod';
import { MetricCard } from '@nexushub/ui';

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

/** Rangée de 4 `MetricCard` pour `get_today_overview`. Parse KO → `null` (silencieux). */
export function KpiCards({ data }: KpiCardsProps) {
  const parsed = TodayOverviewSchema.safeParse(data);
  if (!parsed.success) return null;
  const { blockedCards, dueTodayCards, unreadMails, unreadNotifications } = parsed.data;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MetricCard
        label="Bloquées"
        value={blockedCards}
        valueTone={blockedCards > 0 ? 'danger' : 'neutral'}
      />
      <MetricCard label="Dues aujourd'hui" value={dueTodayCards} />
      <MetricCard label="Mails non lus" value={unreadMails} />
      <MetricCard label="Notifications" value={unreadNotifications} />
    </div>
  );
}
