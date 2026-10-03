/**
 * Square coloured tile with the client's initials, mirroring the
 * `.client-mono` atom from `mockups/09-clients.html`. Reused in the
 * sidebar list, the detail panel header and (later) breadcrumb chips.
 */

import { clientColorCss, clientColorForeground } from '@nexushub/domain';

export interface ClientMonoProps {
  readonly initials: string;
  readonly colorToken: string;
  readonly size?: 40 | 48 | 56 | 64 | 72;
  readonly className?: string;
}

export function ClientMono({ initials, colorToken, size = 56, className }: ClientMonoProps) {
  const base = clientColorCss(colorToken);
  const background = `linear-gradient(135deg, ${base}, color-mix(in srgb, ${base} 65%, white))`;
  const fontSize = size <= 40 ? 12 : size <= 48 ? 14 : size <= 56 ? 18 : 22;
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center font-extrabold tracking-[-0.5px] ${className ?? ''}`}
      style={{
        background,
        color: clientColorForeground(colorToken),
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
