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
          ? 'border-[rgba(139,43,226,0.3)] bg-[image:var(--accent-gradient-soft)] text-[color:var(--color-accent-text)]'
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
          className="-mr-1 ml-0.5 grid h-5 w-5 place-items-center rounded-full text-[color:var(--color-text-muted)] transition-colors hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-text-main)]"
        >
          {/* SVG rather than the "×" glyph: the glyph's font metrics sit it
           *  below the label's centre line. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}
