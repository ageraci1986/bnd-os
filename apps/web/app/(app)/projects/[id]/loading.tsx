/**
 * Skeleton for `/projects/[id]` — Kanban board view. Mirrors the page
 * header + 4 columns of placeholder cards so the user gets immediate
 * visual feedback when they click a project (data fetch can take a
 * few hundred ms over a remote Supabase).
 */
export default function ProjectLoading() {
  const columns = [4, 3, 5, 2];
  return (
    <div className="nx-fade-in mx-auto max-w-[1400px]">
      <nav className="mb-4">
        <div className="nx-skeleton" style={{ height: 30, width: 160, borderRadius: 9999 }} />
      </nav>

      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: 'var(--color-border-light)' }}
            />
            <div className="nx-skeleton" style={{ height: 10, width: 200 }} />
          </div>
          <div className="nx-skeleton mb-2" style={{ height: 32, width: 280 }} />
          <div className="nx-skeleton" style={{ height: 14, width: 420 }} />
        </div>
        <div className="flex items-center gap-3">
          <div className="nx-skeleton" style={{ height: 36, width: 200, borderRadius: 9999 }} />
          <div className="nx-skeleton" style={{ height: 36, width: 36, borderRadius: 9999 }} />
        </div>
      </header>

      <div className="grid grid-cols-[repeat(4,minmax(260px,1fr))] gap-4 overflow-x-auto">
        {columns.map((cardCount, ci) => (
          <section
            key={ci}
            className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3 shadow-[var(--shadow-card)]"
          >
            <header className="mb-3 flex items-center justify-between px-1">
              <div className="nx-skeleton" style={{ height: 12, width: 90 }} />
              <div className="nx-skeleton" style={{ height: 14, width: 22, borderRadius: 9999 }} />
            </header>
            <div className="flex flex-col gap-2">
              {Array.from({ length: cardCount }, (_, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3"
                >
                  <div className="nx-skeleton mb-2" style={{ height: 14, width: 70 }} />
                  <div className="nx-skeleton mb-1.5" style={{ height: 10, width: 50 }} />
                  <div className="nx-skeleton" style={{ height: 14, width: '80%' }} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
