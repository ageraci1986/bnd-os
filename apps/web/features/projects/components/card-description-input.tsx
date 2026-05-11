'use client';
import { useRef, useState } from 'react';
import { updateCard } from '../actions/update-card';

export function CardDescriptionInput({ cardId, initial }: { cardId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <textarea
      rows={4}
      maxLength={8000}
      placeholder="Notes, brief, contraintes…"
      className="description-input"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          void updateCard({ cardId, description: next }).catch(() => {
            // best-effort; the next save will overwrite
          });
        }, 600);
      }}
    />
  );
}
