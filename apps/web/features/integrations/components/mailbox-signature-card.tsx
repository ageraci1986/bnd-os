'use client';
import { useState, useTransition } from 'react';
import { RichTextEditor } from '@/features/communications/components/rich-text-editor';
import { updateSignature } from '../actions/update-signature';

interface Props {
  readonly integrationId: string;
  readonly label: string;
  readonly kind: 'graph' | 'imap';
  readonly initialSignatureHtml: string;
}

export function MailboxSignatureCard({ integrationId, label, kind, initialSignatureHtml }: Props) {
  const [signature, setSignature] = useState(initialSignatureHtml);
  const [pending, start] = useTransition();
  const [savedFlash, setSavedFlash] = useState(false);

  function onSave() {
    start(async () => {
      const r = await updateSignature({ integrationId, signatureHtml: signature });
      if (r.ok) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2_000);
      }
    });
  }

  return (
    <section className="rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{label}</div>
          <div className="text-xs text-[color:var(--color-text-muted)]">
            {kind === 'graph' ? 'Microsoft' : 'IMAP'}
          </div>
        </div>
        {savedFlash ? (
          <span className="text-xs text-[color:var(--color-success)]">✓ Enregistré</span>
        ) : null}
      </header>
      <RichTextEditor value={signature} onChange={setSignature} minHeight={140} />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={onSave}
          className="btn btn-primary btn-sm"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </section>
  );
}
