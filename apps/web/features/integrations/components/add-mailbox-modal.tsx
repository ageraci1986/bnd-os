'use client';
import { useState, useTransition } from 'react';
import { startGraphOAuth } from '../actions/start-graph-oauth';
import { autodiscoverImapAction } from '../actions/autodiscover';
import { testImapConnectionAction } from '../actions/test-imap-connection';
import { addImapMailbox } from '../actions/add-imap-mailbox';
import { updateImapCredentials } from '../actions/update-imap-credentials';

interface Props {
  readonly onClose: () => void;
  readonly reconnectFor: { integrationId: string; email: string } | null;
}

type Step = 'pick' | 'imap-form';
interface TestState {
  tested: boolean;
  ok: boolean;
  message: string | null;
}

const inputClass =
  'w-full rounded-md border px-3 py-2 text-sm border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)]';

export function AddMailboxModal({ onClose, reconnectFor }: Props) {
  const [step, setStep] = useState<Step>(reconnectFor ? 'imap-form' : 'pick');
  const [pending, start] = useTransition();
  const [email, setEmail] = useState(reconnectFor?.email ?? '');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(993);
  const [secure, setSecure] = useState(true);
  const [password, setPassword] = useState('');
  const [autoDetected, setAutoDetected] = useState(false);
  const [test, setTest] = useState<TestState>({ tested: false, ok: false, message: null });
  const [saveError, setSaveError] = useState<string | null>(null);

  function onEmailBlur() {
    if (!email.includes('@') || reconnectFor) return;
    start(async () => {
      const r = await autodiscoverImapAction({ email });
      if (r) {
        setHost(r.host);
        setPort(r.port);
        setSecure(r.secure);
        setAutoDetected(true);
      } else {
        setAutoDetected(false);
      }
    });
  }

  function runTest() {
    setTest({ tested: false, ok: false, message: null });
    start(async () => {
      const r = await testImapConnectionAction({ host, port, secure, username: email, password });
      if (r.ok) setTest({ tested: true, ok: true, message: 'Connexion OK.' });
      else setTest({ tested: true, ok: false, message: `${r.code} : ${r.message}` });
    });
  }

  function save() {
    setSaveError(null);
    start(async () => {
      const res = reconnectFor
        ? await updateImapCredentials({
            integrationId: reconnectFor.integrationId,
            host,
            port,
            secure,
            password,
          })
        : await addImapMailbox({ email, host, port, secure, password });
      if (res.ok) onClose();
      else setSaveError(res.message);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-mailbox-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'pick' ? (
          <>
            <h2 id="add-mailbox-modal-title" className="mb-4 text-lg font-bold">
              Ajouter une boîte email
            </h2>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() =>
                  start(async () => {
                    await startGraphOAuth();
                  })
                }
                className="rounded-lg border border-[color:var(--color-border-light)] px-4 py-3 text-left hover:border-[color:var(--color-accent-primary)]"
              >
                <div className="font-semibold">Microsoft (Outlook / Exchange Online)</div>
                <div className="text-xs text-[color:var(--color-text-muted)]">
                  OAuth — recommandé pour les comptes Microsoft 365.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setStep('imap-form')}
                className="rounded-lg border border-[color:var(--color-border-light)] px-4 py-3 text-left hover:border-[color:var(--color-accent-primary)]"
              >
                <div className="font-semibold">IMAP (Fastmail, OVH, autre)</div>
                <div className="text-xs text-[color:var(--color-text-muted)]">
                  Formulaire manuel — auto-détection sur email connu.
                </div>
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
                Annuler
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="add-mailbox-modal-title" className="mb-4 text-lg font-bold">
              {reconnectFor ? 'Reconnecter' : 'Ajouter'} une boîte IMAP
            </h2>

            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium">Adresse email</span>
              <input
                type="email"
                value={email}
                disabled={!!reconnectFor}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={onEmailBlur}
                className={`${inputClass} disabled:opacity-60`}
              />
            </label>

            {autoDetected ? (
              <p className="mb-3 text-xs font-medium text-[color:var(--color-success)]">
                ✓ Détecté : {host}:{port} ({secure ? 'TLS' : 'clair'})
              </p>
            ) : (
              <div className="mb-3 grid grid-cols-[1fr_100px] gap-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Serveur IMAP</span>
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Port</span>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className={inputClass}
                  />
                </label>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={secure}
                    onChange={(e) => setSecure(e.target.checked)}
                    className="accent-[color:var(--color-accent-primary)]"
                  />
                  <span>TLS (recommandé)</span>
                </label>
              </div>
            )}

            <label className="mb-2 block text-sm">
              <span className="mb-1 block font-medium">Mot de passe</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <p className="mb-4 text-xs text-[color:var(--color-text-muted)]">
              Si ton compte a la 2FA activée, utilise un mot de passe d&apos;application.
            </p>

            {test.tested ? (
              <p
                role="status"
                className={`mb-3 text-xs font-medium ${
                  test.ok ? 'text-[color:var(--color-success)]' : 'text-[color:var(--color-danger)]'
                }`}
              >
                {test.message}
              </p>
            ) : null}
            {saveError ? (
              <p role="alert" className="mb-3 text-xs font-medium text-[color:var(--color-danger)]">
                {saveError}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
                Annuler
              </button>
              <button
                type="button"
                onClick={runTest}
                disabled={pending || !host || !port || !password}
                className="btn btn-sm"
              >
                {pending ? '…' : 'Tester la connexion'}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending || !test.tested || !test.ok}
                className="btn btn-primary btn-sm"
              >
                {pending ? '…' : 'Enregistrer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
