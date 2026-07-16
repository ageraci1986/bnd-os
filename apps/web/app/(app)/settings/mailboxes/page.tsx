import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { MailboxSignatureCard } from '@/features/integrations/components/mailbox-signature-card';

export const metadata: Metadata = { title: 'Boîtes email — Settings' };

export default async function SettingsMailboxesPage() {
  const ctx = await requireUser();
  const mailboxes = await prisma.integration.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: { in: ['graph', 'imap'] },
      status: { in: ['active', 'error'] },
    },
    select: {
      id: true,
      kind: true,
      externalAccountLabel: true,
      signatureHtml: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return (
    <div className="mx-auto max-w-[900px]">
      <header className="mb-6">
        <h1 className="text-[28px] font-extrabold tracking-tight">Boîtes email</h1>
        <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          Signatures et préférences par boîte.
        </p>
      </header>
      <div className="flex flex-col gap-4">
        {mailboxes.map((m) => (
          <MailboxSignatureCard
            key={m.id}
            integrationId={m.id}
            label={m.externalAccountLabel ?? '(sans nom)'}
            kind={m.kind as 'graph' | 'imap'}
            initialSignatureHtml={m.signatureHtml ?? ''}
          />
        ))}
      </div>
    </div>
  );
}
