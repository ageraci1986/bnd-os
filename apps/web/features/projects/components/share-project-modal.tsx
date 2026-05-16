'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { shareProjectWithViewer } from '../actions/share-project-with-viewer';

interface Viewer {
  readonly membershipId: string;
  readonly displayName: string;
  readonly email: string;
  readonly hasAccess: boolean;
}

export interface ShareProjectModalProps {
  readonly projectId: string;
  readonly projectName: string;
  readonly csrfToken: string;
  readonly viewers: readonly Viewer[];
  readonly onClose: () => void;
}

export function ShareProjectModal({
  projectId,
  projectName,
  csrfToken,
  viewers,
  onClose,
}: ShareProjectModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Local optimistic map so toggles feel instant; server confirms.
  const [accessMap, setAccessMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(viewers.map((v) => [v.membershipId, v.hasAccess])),
  );

  const toggle = (membershipId: string, currentValue: boolean) => {
    const next = !currentValue;
    setAccessMap((prev) => ({ ...prev, [membershipId]: next }));
    setErrorMsg(null);
    startTransition(async () => {
      const res = await shareProjectWithViewer({
        projectId,
        membershipId,
        mode: next ? 'share' : 'unshare',
        csrfToken,
      });
      if (!res.ok) {
        setAccessMap((prev) => ({ ...prev, [membershipId]: currentValue }));
        setErrorMsg(res.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-2xl">
        <h2 id="share-modal-title" className="text-xl font-extrabold tracking-tight">
          Partager {projectName}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          Coche les Viewers de cet espace qui doivent avoir accès à ce projet.
        </p>

        {viewers.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-[color:var(--color-border-light)] p-4 text-center text-sm text-[color:var(--color-text-muted)]">
            Aucun Viewer dans cet espace. Invite un Viewer depuis la page Équipe d&apos;abord.
          </p>
        ) : (
          <ul className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-[color:var(--color-border-light)] p-2">
            {viewers.map((v) => (
              <li key={v.membershipId}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[color:var(--color-bg-muted)]">
                  <input
                    type="checkbox"
                    checked={accessMap[v.membershipId] ?? false}
                    onChange={() => toggle(v.membershipId, accessMap[v.membershipId] ?? false)}
                    disabled={pending}
                  />
                  <span className="flex flex-col">
                    <span>{v.displayName}</span>
                    <span className="text-[10px] text-[color:var(--color-text-muted)]">
                      {v.email}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {errorMsg ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-danger)]"
          >
            {errorMsg}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
