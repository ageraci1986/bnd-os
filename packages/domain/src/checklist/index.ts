/**
 * Checklist progression rules (PRD §8.2).
 * Pure helpers; the 1.8s timer is owned by the UI layer (cancellable on uncheck).
 */

export interface ChecklistItem {
  readonly id: string;
  readonly checked: boolean;
}

export function progress(items: readonly ChecklistItem[]): {
  readonly total: number;
  readonly done: number;
  readonly percent: number;
  readonly complete: boolean;
} {
  const total = items.length;
  const done = items.reduce((acc, i) => acc + (i.checked ? 1 : 0), 0);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent, complete: total > 0 && done === total };
}
