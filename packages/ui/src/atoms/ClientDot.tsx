import { cn } from '../utils';

export type ClientColorToken = 'c-acme' | 'c-tech' | 'c-nova' | 'c-lumen' | 'c-orbit';

export interface ClientDotProps {
  /** Token from the workspace palette (matches Client.colorToken in DB). */
  readonly colorToken: ClientColorToken | string;
  readonly size?: number;
  readonly className?: string;
}

/**
 * 8 px coloured dot used by ClientRow, breadcrumb chip and tag-client.
 * Falls back to a literal CSS color if `colorToken` is not a known token.
 */
export function ClientDot({ colorToken, size = 8, className }: ClientDotProps) {
  const isToken = colorToken.startsWith('c-');
  const background = isToken ? `var(--color-${colorToken})` : colorToken;

  return (
    <span
      role="presentation"
      style={{ background, width: size, height: size }}
      className={cn('inline-block shrink-0 rounded-full', className)}
    />
  );
}
