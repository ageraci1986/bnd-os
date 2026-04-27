import { cn } from '../utils';

export type MetricTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface MetricCardProps {
  readonly label: string;
  /** Already formatted (e.g. "03", "27", "14"). PRD §6 Overview. */
  readonly value: string | number;
  readonly trend?: string;
  readonly trendTone?: MetricTone;
  /** Highlights the value itself (used for "Cartes bloquées" → red). */
  readonly valueTone?: MetricTone;
  readonly className?: string;
}

const VALUE_TONE: Record<MetricTone, string> = {
  neutral: 'text-[color:var(--color-text-main)]',
  success: 'text-[color:var(--color-success)]',
  warning: 'text-[color:var(--color-warning)]',
  danger: 'text-[color:var(--color-danger)]',
};

const TREND_TONE: Record<MetricTone, string> = {
  neutral: 'text-[color:var(--color-text-muted)]',
  success: 'text-[color:var(--color-success)]',
  warning: 'text-[color:var(--color-warning)]',
  danger: 'text-[color:var(--color-danger)]',
};

export function MetricCard({
  label,
  value,
  trend,
  trendTone = 'neutral',
  valueTone = 'neutral',
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-[var(--shadow-card)]',
        className,
      )}
    >
      <span className="block text-[11px] font-bold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        {label}
      </span>
      <div
        className={cn(
          'mt-3.5 text-[34px] font-extrabold leading-none tracking-[-1px]',
          VALUE_TONE[valueTone],
        )}
      >
        {value}
      </div>
      {trend ? (
        <div className={cn('mt-2 text-xs font-semibold', TREND_TONE[trendTone])}>{trend}</div>
      ) : null}
    </div>
  );
}
