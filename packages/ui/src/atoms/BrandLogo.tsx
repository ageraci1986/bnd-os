import { cn } from '../utils';

export interface BrandLogoProps {
  /** `lg` pour les écrans d'authentification. */
  readonly size?: 'md' | 'lg';
  readonly className?: string;
}

/**
 * Monogramme « BND » + étincelle + mention « OS » (charte Brand New Day 2026,
 * variante 03 · monogramme, prévue pour les apps). Recomposé en Inter Black en
 * attendant les fichiers maîtres. L'étincelle garde le duo plasma / jaune
 * imposé par la charte, via les tokens de marque.
 */
export function BrandLogo({ size = 'md', className }: BrandLogoProps) {
  return (
    <span
      role="img"
      aria-label="BND OS"
      className={cn('bnd-logo', size === 'lg' && 'is-lg', className)}
    >
      <span className="bnd-logo-word" aria-hidden="true">
        BND
        <svg viewBox="0 0 32 32" focusable="false">
          <circle cx="16" cy="16" r="6" fill="var(--color-accent-secondary)" />
          <path
            d="M16 0 18 14 32 16 18 18 16 32 14 18 0 16 14 14Z"
            fill="var(--color-accent-primary)"
            opacity="0.9"
          />
        </svg>
      </span>
      <span className="bnd-logo-os" aria-hidden="true">
        OS
      </span>
    </span>
  );
}
