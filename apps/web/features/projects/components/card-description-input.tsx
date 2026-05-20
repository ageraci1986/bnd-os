'use client';
import { useRef } from 'react';
import { updateCard } from '../actions/update-card';
import { MarkdownEditor } from './markdown-editor';

export interface CardDescriptionInputProps {
  readonly cardId: string;
  readonly initial: string;
  readonly disabled?: boolean;
}

export function CardDescriptionInput({ cardId, initial, disabled }: CardDescriptionInputProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <MarkdownEditor
      defaultValue={initial}
      placeholder="Notes, brief, contraintes…"
      ariaLabel="Description de la carte"
      {...(disabled ? { disabled: true } : {})}
      onChange={(markdown) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          void updateCard({ cardId, description: markdown }).catch(() => {
            // best-effort autosave; the next change overwrites
          });
        }, 600);
      }}
    />
  );
}
