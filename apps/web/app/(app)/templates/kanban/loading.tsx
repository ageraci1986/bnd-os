/**
 * Skeleton for /templates/kanban — toolbar + warning + horizontal
 * board of 5 placeholder columns. Mirrors the real layout so the
 * page doesn't visibly jump when the data arrives.
 */
export default function KanbanTemplatesLoading() {
  return (
    <div className="nx-fade-in mx-auto max-w-[1400px]">
      <header className="mb-6">
        <div className="nx-skeleton mb-2" style={{ height: 36, width: 380 }} />
        <div className="nx-skeleton" style={{ height: 14, width: 560 }} />
      </header>

      <div className="mb-5 flex items-center justify-between rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-6 py-5">
        <div className="flex items-center gap-4">
          <div className="nx-skeleton" style={{ height: 10, width: 130 }} />
          <div className="nx-skeleton" style={{ height: 40, width: 260, borderRadius: 9999 }} />
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="nx-skeleton"
              style={{ height: 32, width: 90, borderRadius: 9999 }}
            />
          ))}
        </div>
      </div>

      <div className="nx-skeleton mb-5" style={{ height: 56, borderRadius: 16 }} />

      <div className="flex gap-4 overflow-x-auto rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] px-6 py-8">
        {Array.from({ length: 5 }, (_, ci) => (
          <div key={ci} className="flex w-[240px] shrink-0 flex-col">
            <div className="mb-3 flex items-center justify-between border-b-2 border-[color:var(--color-border-light)] pb-3">
              <div className="nx-skeleton" style={{ height: 18, width: 130 }} />
              <div className="nx-skeleton" style={{ height: 18, width: 18, borderRadius: 4 }} />
            </div>
            <div className="nx-skeleton mb-3" style={{ height: 10, width: 160 }} />
            <div className="nx-skeleton" style={{ height: 60, borderRadius: 10 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
