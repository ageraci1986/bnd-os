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
            Récupération <span>sans friction.</span>
          </h2>
          <p>Un e-mail. Un lien. Vous reprenez le contrôle.</p>
        </div>
      </aside>
      <section className="auth-form-wrap">
        <ForgotPasswordForm csrfToken={csrf} />
      </section>
    </main>
  );
}
