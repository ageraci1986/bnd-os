import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { listClients, getClientBySlug } from '@/features/clients/lib/queries';
import { ClientCard } from '@/features/clients/components/client-card';
import { ClientForm } from '@/features/clients/components/client-form';
import { ClientDetailPanel } from '@/features/clients/components/client-detail-panel';

export const metadata: Metadata = { title: 'Clients' };

interface ClientsPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const ctx = await requireUser();
  const csrf = await getCsrfTokenForForm();
  const sp = (await searchParams) ?? {};
  const selectedSlug = readParam(sp['selected']);
  const editing = readParam(sp['edit']) === '1';

  const clients = await listClients(ctx.workspaceId);
  const detail =
    selectedSlug && selectedSlug.length > 0
      ? await getClientBySlug(ctx.workspaceId, selectedSlug)
      : null;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-8">
        <h1 className="text-[34px] font-extrabold tracking-tight">Clients</h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Fiches client, contacts et matrice RACI. Sélectionnez un client pour voir son détail.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
        <section aria-label="Liste des clients" className="space-y-4">
          <ClientForm mode="create" csrfToken={csrf} />

          {clients.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 text-sm text-[color:var(--color-text-muted)]">
              Aucun client pour l’instant. Utilisez le formulaire ci-dessus pour en créer un.
            </div>
          ) : (
            <div>
              {clients.map((c) => (
                <ClientCard
                  key={c.id}
                  slug={c.slug}
                  name={c.name}
                  initials={c.initials}
                  colorToken={c.colorToken}
                  contactsCount={c.contactsCount}
                  projectsCount={c.projectsCount}
                  active={detail?.id === c.id}
                />
              ))}
            </div>
          )}
        </section>

        <section aria-label="Fiche client">
          {detail ? (
            <ClientDetailPanel csrfToken={csrf} client={detail} editing={editing} />
          ) : (
            <div className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-10 text-center shadow-sm">
              <h2 className="text-xl font-extrabold tracking-tight">Sélectionnez un client</h2>
              <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
                {clients.length === 0
                  ? 'Créez votre premier client pour commencer.'
                  : 'Cliquez sur une carte à gauche pour afficher la fiche, les contacts et la matrice RACI.'}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
