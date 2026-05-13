/**
 * Skeleton for the `/projects` grid (list of project cards).
 * Mirrors the real page header + the responsive 1/2/3-column grid so
 * the layout doesn't visibly jump when the data arrives.
 */
export default function ProjectsLoading() {
  return (
    <div className="nx-fade-in mx-auto max-w-[1400px]">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="nx-skeleton mb-2" style={{ height: 32, width: 220 }} />
          <div className="nx-skeleton" style={{ height: 14, width: 360 }} />
        </div>
        <div className="flex items-center gap-3">
          <div className="nx-skeleton" style={{ height: 36, width: 200, borderRadius: 9999 }} />
          <div className="nx-skeleton" style={{ height: 36, width: 140, borderRadius: 9999 }} />
        </div>
      </header>

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <li
            key={i}
            className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)]"
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: 'var(--color-border-light)' }}
              />
              <div className="nx-skeleton" style={{ height: 10, width: 120 }} />
            </div>
            <div className="nx-skeleton mb-2" style={{ height: 22, width: '70%' }} />
            <div className="nx-skeleton mb-1.5" style={{ height: 12, width: '95%' }} />
            <div className="nx-skeleton mb-3" style={{ height: 12, width: '60%' }} />
            <div className="nx-skeleton" style={{ height: 10, width: 80 }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
