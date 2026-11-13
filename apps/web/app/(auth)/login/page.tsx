import type { Metadata } from 'next';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { AuthBrandPanel } from '@/features/auth/components/auth-brand-panel';
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
      <AuthBrandPanel />
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
