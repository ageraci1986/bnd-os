/**
 * Skeleton for `/templates/cards` — 3-column editor. Mirrors the actual
 * layout (list / editor / preview) so the user sees the structure
 * forming as the data arrives.
 */
export default function TemplatesCardsLoading() {
  return (
    <div className="nx-fade-in mx-auto max-w-[1280px]">
      <header className="mb-6">
        <div className="nx-skeleton mb-2" style={{ height: 36, width: 360 }} />
        <div className="nx-skeleton" style={{ height: 14, width: 540 }} />
      </header>

      <div className="grid h-[calc(100vh-220px)] grid-cols-[280px_minmax(360px,0.9fr)_minmax(360px,1.1fr)] gap-4">
        {/* Templates list */}
        <aside className="flex h-full flex-col gap-2 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3">
          <div className="flex items-center justify-between px-1">
            <div className="nx-skeleton" style={{ height: 10, width: 80 }} />
            <div className="nx-skeleton" style={{ height: 22, width: 80, borderRadius: 6 }} />
          </div>
          <div className="mt-1 flex flex-col gap-1.5">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="nx-skeleton"
                style={{ height: 32, width: '100%', borderRadius: 6 }}
              />
            ))}
          </div>
        </aside>

        {/* Editor */}
        <section className="flex h-full flex-col gap-4 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-4">
          <header className="flex items-center gap-3 border-b border-[color:var(--color-border-light)] pb-3">
            <div className="nx-skeleton" style={{ height: 36, width: 36, borderRadius: 9999 }} />
            <div className="nx-skeleton flex-1" style={{ height: 28 }} />
          </header>
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="nx-skeleton"
                style={{ height: 40, width: '100%', borderRadius: 8 }}
              />
            ))}
          </div>
          <div
            className="nx-skeleton mt-auto"
            style={{ height: 44, width: '100%', borderRadius: 8 }}
          />
        </section>

        {/* Preview */}
        <aside className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-4">
          <div className="mb-4">
            <div className="nx-skeleton mb-2" style={{ height: 10, width: 60 }} />
            <div className="nx-skeleton" style={{ height: 24, width: 200 }} />
          </div>
          <div className="grid gap-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i}>
                <div className="nx-skeleton mb-1.5" style={{ height: 10, width: 90 }} />
                <div className="nx-skeleton" style={{ height: 36 }} />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
