import { cn } from '../utils';

export type TagVariant =
  | 'neutral'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'primary'
  // Category tags from the mockups (kanban cards / urgent tasks)
  | 'design'
  | 'copy'
  | 'video'
  | 'strategy'
  | 'tiktok'
  | 'insta';

export type TagSize = 'sm' | 'md';

export interface TagProps {
  readonly variant: TagVariant;
  readonly size?: TagSize;
  readonly children: React.ReactNode;
  readonly className?: string;
}

const VARIANTS: Record<TagVariant, string> = {
  neutral: 'bg-[color:var(--color-bg-soft)] text-[color:var(--color-text-muted)]',
  success: 'bg-[color:var(--color-success-bg)] text-[color:var(--color-success)]',
  danger: 'bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)]',
  warning: 'bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)]',
  info: 'bg-[color:var(--color-info-bg)] text-[color:var(--color-info)]',
  primary:
    'bg-[image:var(--accent-gradient-soft)] text-[color:var(--color-accent-primary)] dark:text-[#C084FC]',
  design: 'bg-[rgba(255,42,109,0.1)] text-[color:var(--color-accent-secondary)]',
  copy: 'bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)]',
  video: 'bg-[color:var(--color-info-bg)] text-[color:var(--color-info)]',
  strategy:
    'bg-[image:var(--accent-gradient-soft)] text-[color:var(--color-accent-primary)] dark:text-[#C084FC]',
  tiktok: 'bg-[color:var(--color-success-bg)] text-[color:var(--color-success)]',
  insta: 'bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)]',
};

const SIZES: Record<TagSize, string> = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-1 text-[11px]',
};

/** Pill-shaped tag (10px uppercase, rounded full). */
export function Tag({ variant, size = 'md', children, className }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-[0.5px]',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
