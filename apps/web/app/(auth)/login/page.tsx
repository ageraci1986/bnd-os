import type { Metadata } from 'next';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { LoginForm } from '@/features/auth/components/login-form';

export const metadata: Metadata = {
  title: 'Connexion',
};

interface LoginPageProps {
  readonly searchParams: Promise<{ readonly next?: string; readonly reset?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const csrf = await getCsrfTokenForForm();
  const params = await searchParams;
  const next =
    typeof params.next === 'string' && params.next.startsWith('/') ? params.next : undefined;
  const resetSuccess = params.reset === '1';

  return (
    <main className="auth">
      <aside className="auth-visual" aria-hidden="true">
        <div className="auth-brand">
          <div className="brand-mark">N</div>
          <div>
            <span className="brand-name">NexusHub</span>
            <span className="brand-sub">Agency OS</span>
          </div>
        </div>
        <div className="auth-hero">
          <h2>
            Tout votre studio,
            <br />
            <span>en un seul espace.</span>
          </h2>
          <p>
            Client, projet, tâche : la chaîne complète d&apos;une agence dans une interface unique.
          </p>
          <div className="auth-stats">
            <div>
              <div className="auth-stat-value">5 → 20</div>
              <div className="auth-stat-label">Membres</div>
            </div>
            <div>
              <div className="auth-stat-value">100%</div>
              <div className="auth-stat-label">Multi-clients</div>
            </div>
          </div>
        </div>
      </aside>
      <section className="auth-form-wrap">
        <LoginForm
          csrfToken={csrf}
          {...(next ? { nextUrl: next } : {})}
          resetSuccess={resetSuccess}
        />
      </section>
    </main>
  );
}
