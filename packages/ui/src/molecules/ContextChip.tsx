import { ClientDot, type ClientColorToken } from '../atoms/ClientDot';
import { cn } from '../utils';

export interface ContextChipProps {
  readonly label: string;
  /** When provided, shows a coloured dot before the label. */
  readonly colorToken?: ClientColorToken | string;
  /** When `onClear` is given the chip renders a × button. PRD §8.1. */
  readonly onClear?: () => void;
  readonly clearLabel?: string;
  readonly active?: boolean;
  readonly className?: string;
}

/**
 * The pill that lives in the ContextBar showing the active client filter
 * (or "Tous les clients" when none). Pure visual — host wires `onClear`
 * to update the URL + Zustand store.
 */
export function ContextChip({
  label,
  colorToken,
  onClear,
  clearLabel = 'Retirer le filtre client',
  active,
  className,
}: ContextChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[var(--shadow-card)]',
        active
          ? 'border-[rgba(139,43,226,0.3)] bg-[image:var(--accent-gradient-soft)] text-[color:var(--color-accent-primary)] dark:text-[#C084FC]'
          : 'border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] text-[color:var(--color-text-main)]',
        className,
      )}
    >
      {colorToken ? <ClientDot colorToken={colorToken} size={8} /> : null}
      <span className="leading-none">{label}</span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="ml-1 grid h-4 w-4 place-items-center rounded-full text-[15px] leading-none text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-main)]"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
