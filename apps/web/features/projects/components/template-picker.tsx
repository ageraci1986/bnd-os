'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeCardTemplate } from '../actions/change-card-template';

export interface TemplateOption {
  readonly id: string;
  readonly name: string;
}

export interface TemplatePickerProps {
  readonly cardId: string;
  readonly currentTemplateId: string | null;
  readonly templates: readonly TemplateOption[];
}

/**
 * Inline template switcher rendered in the card modal side rail.
 * Selecting a different template re-shapes the card's structured fields
 * (server-side prunes values for fields that no longer exist).
 */
export function TemplatePicker({ cardId, currentTemplateId, templates }: TemplatePickerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    if (next === (currentTemplateId ?? '')) return;
    startTransition(async () => {
      const res = await changeCardTemplate({ cardId, templateId: next });
      if (!res.ok) {
        window.alert(res.message);
        return;
      }
      router.refresh();
    });
  };

  if (templates.length === 0) {
    return (
      <p className="text-xs text-[color:var(--color-text-muted)]">Aucun template disponible.</p>
    );
  }

  return (
    <select
      value={currentTemplateId ?? ''}
      onChange={onChange}
      disabled={pending}
      className="field-select"
    >
      <option value="">— Sans template —</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
