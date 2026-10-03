import { type ClientColorToken } from '../atoms/ClientDot';
import { clientColorCss } from '../client-color';
import { cn } from '../utils';

export interface ClientRowProps {
  readonly name: string;
  readonly colorToken: ClientColorToken | string;
  /** Active project count shown on the right. Hidden when 0. */
  readonly count?: number;
  readonly active?: boolean;
  readonly className?: string;
}

/**
 * Sidebar row for a client. Faithful port of the mockup `.client-row`
 * with the `.c-acme` / `.c-tech` / etc. token-driven dot color.
 */
export function ClientRow({ name, colorToken, count, active, className }: ClientRowProps) {
  const dotStyle = { background: clientColorCss(colorToken) };

  return (
    <span className={cn('client-row', active && 'active', className)}>
      <span aria-hidden="true" className="client-dot" style={dotStyle} />
      <span className="client-name">{name}</span>
      {count !== undefined && count > 0 ? <span className="client-count">{count}</span> : null}
    </span>
  );
}
