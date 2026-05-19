'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { createWorkspaceWithAdmin } from '../actions/create-workspace-with-admin';
import { notify } from '@/features/shell/components/toaster';

interface Props {
  readonly csrfToken: string;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '') // strip diacritics via Unicode property escape
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function CreateWorkspaceForm({ csrfToken }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  // Auto-fill slug from the name as long as the user hasn't typed their own.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createWorkspaceWithAdmin({ status: 'idle' }, fd);
      if (result.status === 'error') {
        notify({ tone: 'error', message: result.message });
      } else if (result.status === 'success') {
        notify({
          tone: 'success',
          message: `Workspace « ${result.workspaceName} » créé. Invitation envoyée à ${result.adminEmail}.`,
        });
        formRef.current?.reset();
        setName('');
        setSlug('');
        setSlugTouched(false);
      }
    });
  };

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6"
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="ws-name">
            Nom du workspace
          </label>
          <input
            id="ws-name"
            name="name"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Agency"
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="ws-slug">
            Slug (URL)
          </label>
          <input
            id="ws-slug"
            name="slug"
            type="text"
            required
            minLength={3}
            maxLength={60}
            pattern="[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            placeholder="acme-agency"
            className="field-input"
            aria-describedby="ws-slug-hint"
          />
          <p id="ws-slug-hint" className="mt-1 text-[10px] text-[color:var(--color-text-muted)]">
            Minuscules, chiffres et tirets uniquement. Auto-généré depuis le nom.
          </p>
        </div>
      </div>
      <div className="mt-4">
        <label className="field-label" htmlFor="ws-admin-email">
          Email du premier Admin
        </label>
        <input
          id="ws-admin-email"
          name="adminEmail"
          type="email"
          required
          maxLength={254}
          placeholder="admin@acme-agency.com"
          className="field-input"
        />
        <p className="mt-1 text-[10px] text-[color:var(--color-text-muted)]">
          Recevra une invitation Admin (lien valide 72h). Pourra ensuite inviter ses propres
          membres.
        </p>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? 'Création…' : '+ Créer le workspace'}
        </button>
        <span className="text-[11px] text-[color:var(--color-text-muted)]">
          Le super-admin ne devient pas membre du nouveau workspace.
        </span>
      </div>
    </form>
  );
}
