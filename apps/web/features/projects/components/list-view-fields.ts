/**
 * Field definitions for the project Liste view. Each entry is shown
 * as an opt-in pill in the column picker; the user's selection is
 * persisted per project in localStorage (see `useListViewColumns`).
 *
 * `title` is implicit / always shown — it's the primary identifier of
 * each row and is never listed here.
 */

export const LIST_VIEW_FIELDS = [
  { id: 'column', label: 'Colonne' },
  { id: 'shortRef', label: 'Référence' },
  { id: 'category', label: 'Catégorie' },
  { id: 'dueDate', label: 'Échéance' },
  { id: 'assignees', label: 'Assignés' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'template', label: 'Template' },
] as const;

export type ListViewFieldId = (typeof LIST_VIEW_FIELDS)[number]['id'];

export const DEFAULT_LIST_VIEW_FIELDS: readonly ListViewFieldId[] = ['column'];

export function isListViewFieldId(value: unknown): value is ListViewFieldId {
  return (
    typeof value === 'string' &&
    (LIST_VIEW_FIELDS as readonly { id: string }[]).some((f) => f.id === value)
  );
}
