'use client';
import { useState } from 'react';
import { ShareProjectModal } from './share-project-modal';

interface Viewer {
  readonly membershipId: string;
  readonly displayName: string;
  readonly email: string;
  readonly hasAccess: boolean;
}

export interface ShareProjectButtonProps {
  readonly projectId: string;
  readonly projectName: string;
  readonly csrfToken: string;
  readonly viewers: readonly Viewer[];
}

export function ShareProjectButton(props: ShareProjectButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm">
        Partager
      </button>
      {open ? <ShareProjectModal {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
