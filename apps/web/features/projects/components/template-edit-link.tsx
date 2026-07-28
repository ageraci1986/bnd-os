import Link from 'next/link';

/**
 * Side-rail escape hatch under the TemplatePicker: jump to the card-template
 * editor (deep-linked on the card's template). CRUD on templates is open to
 * Admin AND Membre (CLAUDE.md §6.7) — the caller only hides it in read-only
 * (viewer) mode.
 */
export function TemplateEditLink({ templateId }: { readonly templateId: string | null }) {
  if (!templateId) {
    return (
      <p className="mt-1 text-[10px] text-[color:var(--color-text-muted)]">
        Aucun template appliqué —{' '}
        <Link href="/templates/cards" className="underline hover:text-[color:var(--color-text)]">
          Gérer les templates
        </Link>
      </p>
    );
  }
  return (
    <p className="mt-1 text-[10px] text-[color:var(--color-text-muted)]">
      <Link
        href={`/templates/cards?template=${templateId}`}
        className="underline hover:text-[color:var(--color-text)]"
      >
        Modifier le template
      </Link>
    </p>
  );
}
