export default function MyProjectsLoading() {
  return (
    <div className="nx-fade-in mx-auto max-w-6xl">
      <header className="mb-8">
        <div className="nx-skeleton mb-2" style={{ height: 36, width: 200 }} />
        <div className="nx-skeleton" style={{ height: 14, width: 320 }} />
      </header>
      <div className="flex flex-col gap-8">
        {Array.from({ length: 2 }, (_, ci) => (
          <section key={ci}>
            <div className="nx-skeleton mb-3" style={{ height: 12, width: 140 }} />
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, pi) => (
                <li
                  key={pi}
                  className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5"
                >
                  <div className="nx-skeleton mb-2" style={{ height: 18, width: '70%' }} />
                  <div className="nx-skeleton" style={{ height: 12, width: '90%' }} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
