import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-xl text-center">
        <h1 className="mb-4 text-4xl font-extrabold tracking-tight">NexusHub</h1>
        <p className="mb-6 text-[color:var(--color-text-muted)]">
          Agency OS — bootstrap en cours. Voir{' '}
          <code className="rounded bg-[color:var(--color-bg-hover)] px-1.5 py-0.5">
            progress.md
          </code>{' '}
          pour l&apos;avancement.
        </p>
        <Link
          href="/login"
          className="inline-flex rounded-full bg-gradient-to-br from-[#8B2BE2] to-[#FF2A6D] px-6 py-3 font-bold text-white shadow-lg transition hover:translate-y-[-2px]"
        >
          Se connecter
        </Link>
      </div>
    </main>
  );
}
