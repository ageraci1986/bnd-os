'use client';
import { useState } from 'react';
import { MailboxCard, type MailboxCardData } from './mailbox-card';
import { AddMailboxModal } from './add-mailbox-modal';

export function MailboxList({ mailboxes }: { readonly mailboxes: readonly MailboxCardData[] }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [reconnectTarget, setReconnectTarget] = useState<MailboxCardData | null>(null);

  const openAdd = (): void => {
    setReconnectTarget(null);
    setModalOpen(true);
  };
  const openReconnect = (mailbox: MailboxCardData): void => {
    setReconnectTarget(mailbox);
    setModalOpen(true);
  };
  const closeModal = (): void => {
    setModalOpen(false);
    setReconnectTarget(null);
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[color:var(--color-text-main)]">Boîtes email</h2>
        <button type="button" onClick={openAdd} className="btn btn-primary btn-sm">
          + Ajouter une boîte
        </button>
      </div>
      {mailboxes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 text-xs text-[color:var(--color-text-muted)]">
          Aucune boîte connectée. Ajoute-en une pour voir tes mails dans Communications.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {mailboxes.map((mailbox) => (
            <MailboxCard
              key={mailbox.integrationId}
              data={mailbox}
              {...(mailbox.kind === 'imap' ? { onReconnect: () => openReconnect(mailbox) } : {})}
            />
          ))}
        </div>
      )}
      {modalOpen ? (
        <AddMailboxModal
          onClose={closeModal}
          reconnectFor={
            reconnectTarget
              ? { integrationId: reconnectTarget.integrationId, email: reconnectTarget.label }
              : null
          }
        />
      ) : null}
    </section>
  );
}
