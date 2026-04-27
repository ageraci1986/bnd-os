import { cn } from '../utils';

export interface SearchBarProps {
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly name?: string;
  readonly className?: string;
  /** Disable the input visually (Phase 11 will wire actual search). */
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
}

/**
 * Pill-shaped search input with a leading icon. Pure visual — keystroke
 * handling and search routing land in Phase 11 (global search).
 */
export function SearchBar({
  placeholder = 'Rechercher un projet, une tâche, un contact…',
  defaultValue,
  name = 'q',
  className,
  disabled,
  ariaLabel = 'Rechercher',
}: SearchBarProps) {
  return (
    <label className={cn('relative inline-block', className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2 text-base text-[color:var(--color-text-muted)]"
      >
        ⌕
      </span>
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          'w-[340px] rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] py-3 pl-11 pr-5 text-[13px] font-medium text-[color:var(--color-text-main)] shadow-[var(--shadow-card)] outline-none transition',
          'placeholder:text-[color:var(--color-text-muted)] focus:border-[color:var(--color-accent-primary)] focus:shadow-[0_0_0_3px_rgba(139,43,226,0.1)]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      />
    </label>
  );
}
