/**
 * Skeleton for /projects/[id]/list — back link, header, view-toggle,
 * column picker + a few card rows. Same overall shell as the real page
 * so there's no visible jump on data arrival.
 */
export default function ProjectListLoading() {
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
          <div className="nx-skeleton" style={{ height: 36, width: 260, borderRadius: 9999 }} />
          <div className="nx-skeleton" style={{ height: 36, width: 36, borderRadius: 9999 }} />
        </div>
      </header>

      <div className="mb-3 flex items-center justify-between">
        <div className="nx-skeleton" style={{ height: 12, width: 200 }} />
        <div className="nx-skeleton" style={{ height: 30, width: 140, borderRadius: 9999 }} />
      </div>

      <div className="flex flex-col gap-6">
        {Array.from({ length: 2 }, (_, ci) => (
          <section key={ci} className="flex flex-col gap-2">
            <div className="nx-skeleton" style={{ height: 10, width: 90 }} />
            <ul className="flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, ri) => (
                <li
                  key={ri}
                  className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-3 shadow-[var(--shadow-card)]"
                >
                  <div className="nx-skeleton mb-2" style={{ height: 10, width: 60 }} />
                  <div className="nx-skeleton mb-1.5" style={{ height: 16, width: '60%' }} />
                  <div className="nx-skeleton" style={{ height: 10, width: '40%' }} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
