'use client';

interface Props {
  readonly onClose: () => void;
  readonly reconnectFor: { integrationId: string; email: string } | null;
}

// Stub — real implementation lands in Task 18.
export function AddMailboxModal(_props: Props): null {
  return null;
}
