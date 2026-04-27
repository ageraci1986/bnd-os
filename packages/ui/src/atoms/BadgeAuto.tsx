import { cn } from '../utils';

export interface BadgeAutoProps {
  readonly label?: string;
  readonly className?: string;
}

/**
 * Gradient pill marking system-driven actions in the activity feed
 * (auto-move, auto-block, auto-archive). PRD §6 + §8.2 / §8.3.
 */
export function BadgeAuto({ label = 'Auto', className }: BadgeAutoProps) {
  return (
    <span
      style={{ background: 'linear-gradient(135deg,#8B2BE2,#FF2A6D)', color: '#fff' }}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
        className,
      )}
    >
      <span className="text-[8px]" aria-hidden="true">
        ◆
      </span>
      {label}
    </span>
  );
}
