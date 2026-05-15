import Link from 'next/link';

export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-[28px] font-extrabold tracking-tight">Page introuvable</h1>
      <p className="mt-3 text-sm text-[color:var(--color-text-muted)]">
        Cette page n&apos;existe pas, ou tu n&apos;y as pas accès depuis ce workspace.
      </p>
      <Link href="/overview" className="btn btn-primary btn-sm mt-6 inline-block">
        Retour à l&apos;Overview
      </Link>
    </div>
  );
}
