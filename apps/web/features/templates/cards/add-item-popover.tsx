'use client';
import { useEffect, useRef, useState } from 'react';
import { CARD_TEMPLATE_ITEM_TYPES, type CardTemplateItem } from '@nexushub/domain';

const ICONS: Record<CardTemplateItem['type'], string> = {
  text: 'Aa',
  longtext: '¶',
  select: '▣',
  link: '🔗',
  checkbox: '☑',
  date: '📅',
  number: '#',
  section: '§',
  description: '¶',
};

export interface AddItemPopoverProps {
  readonly hasDescription: boolean;
  readonly onAdd: (type: CardTemplateItem['type']) => void;
}

export function AddItemPopover({ hasDescription, onAdd }: AddItemPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (type: CardTemplateItem['type']) => {
    if (type === 'description' && hasDescription) return;
    setOpen(false);
    onAdd(type);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-lg border border-dashed border-[color:var(--color-border-light)] px-3 py-2.5 text-sm text-[color:var(--color-text-muted)] hover:border-[color:var(--color-accent-primary)] hover:text-[color:var(--color-text-main)]"
      >
        + Ajouter un item
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-1.5 shadow-lg">
          {CARD_TEMPLATE_ITEM_TYPES.map((t, idx) => {
            const isSep = idx === 7; // after `number`, before `section`
            const disabled = t.id === 'description' && hasDescription;
            return (
              <div key={t.id}>
                {isSep ? <div className="my-1 h-px bg-[color:var(--color-border-light)]" /> : null}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(t.id)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm ${
                    disabled
                      ? 'cursor-not-allowed text-[color:var(--color-text-muted)] opacity-50'
                      : 'hover:bg-[color:var(--color-bg-muted)]'
                  }`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[color:var(--color-bg-muted)] text-xs">
                    {ICONS[t.id]}
                  </span>
                  <span className="flex-1">{t.label}</span>
                  {disabled ? (
                    <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
                      déjà présente
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
