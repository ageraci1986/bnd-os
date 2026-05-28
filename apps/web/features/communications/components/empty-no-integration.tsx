import Link from 'next/link';

export function EmptyNoIntegration() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--color-bg-muted)] text-2xl">
        📧
      </div>
      <h3 className="mb-2 text-base font-extrabold text-[color:var(--color-text-main)]">
        Connecte ta boîte Outlook
      </h3>
      <p className="mb-5 max-w-sm text-sm leading-relaxed text-[color:var(--color-text-muted)]">
        Centralise tes mails clients dans NexusHub. On affiche chaque message en regard du bon
        client (auto-association par domaine).
      </p>
      <Link href="/integrations" className="btn btn-primary">
        Aller dans Intégrations →
      </Link>
      <p className="mt-4 text-[11px] text-[color:var(--color-text-muted)]">
        Lecture seule pour cette itération. Envoi de réponses dans la prochaine.
      </p>
    </div>
  );
}
