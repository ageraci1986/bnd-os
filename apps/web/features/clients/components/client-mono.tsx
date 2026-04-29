/**
 * Square coloured tile with the client's initials, mirroring the
 * `.client-mono` atom from `mockups/09-clients.html`. Reused in the
 * sidebar list, the detail panel header and (later) breadcrumb chips.
 */

const FALLBACK_GRADIENT = 'linear-gradient(135deg,#FF2A6D,#FF6B9D)';

const GRADIENTS: Record<string, string> = {
  'c-acme': FALLBACK_GRADIENT,
  'c-tech': 'linear-gradient(135deg,#2563EB,#60A5FA)',
  'c-nova': 'linear-gradient(135deg,#059669,#10B981)',
  'c-lumen': 'linear-gradient(135deg,#F59E0B,#FBBF24)',
  'c-orbit': 'linear-gradient(135deg,#8B2BE2,#C084FC)',
};

export interface ClientMonoProps {
  readonly initials: string;
  readonly colorToken: string;
  readonly size?: 40 | 48 | 56 | 64 | 72;
  readonly className?: string;
}

export function ClientMono({ initials, colorToken, size = 56, className }: ClientMonoProps) {
  const background = GRADIENTS[colorToken] ?? FALLBACK_GRADIENT;
  const fontSize = size <= 40 ? 12 : size <= 48 ? 14 : size <= 56 ? 18 : 22;
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center font-extrabold tracking-[-0.5px] text-white ${className ?? ''}`}
      style={{
        background,
        width: size,
        height: size,
        borderRadius: 14,
        fontSize,
      }}
    >
      {initials}
    </span>
  );
}
