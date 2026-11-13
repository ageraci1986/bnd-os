import { AuthBrandPanel } from '@/features/auth/components/auth-brand-panel';
import type { Metadata } from 'next';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { ForgotPasswordForm } from '@/features/auth/components/forgot-password-form';

export const metadata: Metadata = {
  title: 'Mot de passe oublié',
};

export default async function ForgotPasswordPage() {
  const csrf = await getCsrfTokenForForm();
  return (
    <main className="auth">
      <AuthBrandPanel />
      <section className="auth-form-wrap">
        <ForgotPasswordForm csrfToken={csrf} />
      </section>
    </main>
  );
}
