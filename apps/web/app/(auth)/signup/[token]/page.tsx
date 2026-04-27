import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { checkInvitationUsable, crypto as nhCrypto } from '@nexushub/domain';
import { getServerEnv } from '@/lib/env';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { SignupForm } from '@/features/invitations/components/signup-form';

export const metadata: Metadata = {
  title: 'Créer mon compte',
  robots: { index: false, follow: false },
};

interface SignupPageProps {
  readonly params: Promise<{ readonly token: string }>;
}

export default async function SignupPage({ params }: SignupPageProps) {
  const { token } = await params;

  const env = getServerEnv();
  const shapeOk = await nhCrypto.validateInvitationTokenShape(token, env.INVITATION_SECRET);
  if (!shapeOk) {
    return <InvalidLink reason="invalid" />;
  }

  const tokenHash = await nhCrypto.sha256Hex(token);

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      expiresAt: true,
      consumedAt: true,
      status: true,
      workspace: { select: { name: true } },
      createdBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  if (!invitation) {
    return <InvalidLink reason="invalid" />;
  }

  const usable = checkInvitationUsable(
    {
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      consumedAt: invitation.consumedAt,
    },
    new Date(),
  );
  if (!usable.ok) {
    return <InvalidLink reason={usable.reason} />;
  }

  const csrf = await getCsrfTokenForForm();
  const inviter = invitation.createdBy;
  const inviterName =
    [inviter.firstName, inviter.lastName]
      .filter((s): s is string => Boolean(s))
      .join(' ')
      .trim() || inviter.email;

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
            Bienvenue
            <br />
            <span>dans l&apos;équipe.</span>
          </h2>
          <p>Définissez votre mot de passe pour rejoindre {invitation.workspace.name}.</p>
        </div>
      </aside>
      <section className="auth-form-wrap">
        <SignupForm
          csrfToken={csrf}
          token={token}
          email={invitation.email}
          workspaceName={invitation.workspace.name}
          inviterName={inviterName}
        />
      </section>
    </main>
  );
}

type InvalidReason = 'invalid' | 'expired' | 'consumed' | 'revoked' | 'config';

function InvalidLink({ reason }: { reason: InvalidReason }) {
  const { title, message } = messages[reason];
  return (
    <main className="auth">
      <aside className="auth-visual" aria-hidden="true">
        <div className="auth-brand">
          <div className="brand-mark">N</div>
          <div>
            <span className="brand-name">NexusHub</span>
          </div>
        </div>
      </aside>
      <section className="auth-form-wrap">
        <div className="auth-form text-center">
          <p className="auth-kicker">Invitation</p>
          <h1 className="auth-title">{title}</h1>
          <p className="auth-sub">{message}</p>
          <Link href="/login" className="btn btn-ghost btn-lg mt-4 inline-flex">
            Retour à la connexion
          </Link>
        </div>
      </section>
    </main>
  );
}

const messages: Record<InvalidReason, { title: string; message: string }> = {
  invalid: {
    title: 'Lien invalide',
    message:
      "Ce lien d'invitation est invalide. Demandez à l'Admin de votre espace de vous renvoyer une invitation.",
  },
  expired: {
    title: 'Lien expiré',
    message:
      "Ce lien d'invitation a expiré (validité : 72 h). Demandez à l'Admin de votre espace une nouvelle invitation.",
  },
  consumed: {
    title: 'Lien déjà utilisé',
    message: 'Cette invitation a déjà été acceptée. Connectez-vous avec votre adresse e-mail.',
  },
  revoked: {
    title: 'Invitation révoquée',
    message:
      'Cette invitation a été révoquée par un Admin. Demandez-en une nouvelle si nécessaire.',
  },
  config: {
    title: 'Configuration manquante',
    message:
      "Le service d'invitation est temporairement indisponible. Contactez un administrateur.",
  },
};
