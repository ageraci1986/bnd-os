import { cn } from '../utils';

export type AvatarSize = 'sm' | 'md' | 'lg';
export type AvatarVariant = 'default' | 'gradient' | 'client';

export interface AvatarProps {
  /** 1–4 char string. Computed by caller from name or email. */
  readonly initials: string;
  readonly size?: AvatarSize;
  readonly variant?: AvatarVariant;
  /** Required when variant === 'client': CSS color (e.g. var(--c-acme)). */
  readonly color?: string;
  /** Optional extra classes (Tailwind-friendly). */
  readonly className?: string;
  readonly title?: string;
  /** ARIA: pass an explicit label when the visual is purely decorative. */
  readonly ariaHidden?: boolean;
}

const SIZES: Record<AvatarSize, string> = {
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-10 w-10 text-sm',
};

/**
 * Circular initials avatar. Pure visual — no `<img>` fallback yet (Phase 9.2
 * will add real avatars from Supabase Storage and switch to `<img>` + skeleton).
 */
export function Avatar({
  initials,
  size = 'md',
  variant = 'default',
  color,
  className,
  title,
  ariaHidden,
}: AvatarProps) {
  const style: React.CSSProperties =
    variant === 'gradient'
      ? { background: 'linear-gradient(135deg,#8B2BE2,#FF2A6D)', color: '#fff' }
      : variant === 'client' && color
        ? { background: color, color: '#fff' }
        : {};

  return (
    <span
      title={title}
      aria-hidden={ariaHidden ? true : undefined}
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : (title ?? initials)}
      style={style}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-bold uppercase tracking-tight',
        SIZES[size],
        variant === 'default' &&
          'bg-[color:var(--color-bg-hover)] text-[color:var(--color-text-main)]',
        className,
      )}
    >
      {initials.slice(0, 4)}
    </span>
  );
}
