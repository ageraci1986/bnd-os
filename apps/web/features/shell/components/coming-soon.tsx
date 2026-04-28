export interface ComingSoonProps {
  readonly title: string;
  readonly phase: string;
  readonly description: string;
}

/**
 * Placeholder shown for routes whose feature module hasn't been built yet
 * (Phases 4–9). Lets the user navigate the shell end-to-end without 404s.
 */
export function ComingSoon({ title, phase, description }: ComingSoonProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-[12px] font-bold uppercase tracking-[1.5px] text-[color:var(--color-text-muted)]">
        Bientôt — {phase}
      </p>
      <h1 className="mt-3 text-[34px] font-extrabold leading-[1.1] tracking-[-1px]">{title}</h1>
      <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-[color:var(--color-text-muted)]">
        {description}
      </p>
      <div
        className="mt-8 rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 text-sm text-[color:var(--color-text-muted)]"
        role="status"
      >
        Cette section n&apos;est pas encore implémentée. Le shell, le filtre client global et
        l&apos;auth fonctionnent déjà — la suite arrive avec sa propre PR.
      </div>
    </div>
  );
}
