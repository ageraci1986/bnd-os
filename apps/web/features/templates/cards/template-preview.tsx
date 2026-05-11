'use client';
import type { CardTemplateItem } from '@nexushub/domain';
import { PreviewCardBody } from './preview-card-body';

export interface TemplatePreviewProps {
  readonly templateName: string;
  readonly items: readonly CardTemplateItem[];
}

export function TemplatePreview({ templateName, items }: TemplatePreviewProps) {
  return (
    <aside className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
      <header className="mb-4">
        <p className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
          Aperçu
        </p>
        <h2 className="text-lg font-bold">{templateName || 'Sans titre'}</h2>
      </header>
      <PreviewCardBody items={items} />
    </aside>
  );
}
