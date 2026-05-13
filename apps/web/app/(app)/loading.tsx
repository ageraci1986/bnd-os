/**
 * Generic fallback shown by Next.js while any `/(app)/...` route streams
 * in. Mirrors the page header + a coarse content grid so the user sees
 * the page take shape immediately on click, instead of a blank wait.
 *
 * Routes with heavier or distinctive layouts override this with a
 * dedicated `loading.tsx` next to their page (e.g. /projects/[id]).
 */
export default function AppLoading() {
  return (
    <div className="nx-fade-in mx-auto max-w-[1400px]">
      <header className="mb-6">
        <div className="nx-skeleton mb-3" style={{ height: 32, width: 320 }} />
        <div className="nx-skeleton" style={{ height: 14, width: 480 }} />
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)]"
          >
            <div className="nx-skeleton mb-3" style={{ height: 10, width: 90 }} />
            <div className="nx-skeleton mb-2" style={{ height: 20, width: '70%' }} />
            <div className="nx-skeleton" style={{ height: 12, width: '90%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
