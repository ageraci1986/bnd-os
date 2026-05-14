/**
 * Workspace-defined Kanban templates (PRD §7.2).
 *
 * A template = an ordered list of column names. At project creation
 * time the columns are copy-on-create from the template into the new
 * project's `columns` table. The template stays frozen for existing
 * projects (decision ADR §6.4); editing it later only affects future
 * project creations.
 *
 * The system "Bloqué" column at position 9999 is added automatically
 * by `buildProjectColumns` in `../projects/index.ts` and is therefore
 * NOT part of the template column list.
 */

export const KANBAN_TEMPLATE_NAME_MAX = 80;
export const KANBAN_COLUMN_NAME_MAX = 60;
export const KANBAN_COLUMNS_MAX = 20;
export const KANBAN_STEP_CHECKLIST_MAX = 20;
export const KANBAN_STEP_CHECKLIST_LABEL_MAX = 200;

export interface WorkspaceKanbanTemplate {
  readonly id: string;
  readonly name: string;
  readonly columns: readonly KanbanTemplateColumnDef[];
  readonly usageCount?: number;
}

export interface KanbanTemplateColumnDef {
  /** Stable identifier — present for persisted columns, absent for
   *  unsaved drafts (the client uses a temp `tmp-…` id until save). */
  readonly id?: string;
  readonly name: string;
  /** Per-column step checklist (Phase B). Items copied onto each card
   *  in this column at creation / column move so the user knows what
   *  to do in this phase. Empty = no step checklist. */
  readonly stepChecklist: readonly string[];
}

export function validateKanbanTemplateName(
  raw: string,
): { ok: true; value: string } | { ok: false; code: 'EMPTY' | 'TOO_LONG' } {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, code: 'EMPTY' };
  if (value.length > KANBAN_TEMPLATE_NAME_MAX) return { ok: false, code: 'TOO_LONG' };
  return { ok: true, value };
}

export function validateKanbanColumnName(
  raw: string,
): { ok: true; value: string } | { ok: false; code: 'EMPTY' | 'TOO_LONG' } {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, code: 'EMPTY' };
  if (value.length > KANBAN_COLUMN_NAME_MAX) return { ok: false, code: 'TOO_LONG' };
  return { ok: true, value };
}

/**
 * Validate the array of columns submitted by the editor. Each column
 * must have a non-empty name. Duplicate names within a single template
 * are allowed (user choice), but the editor warns about them. Returns
 * the cleaned columns on success, or `null` on the first invariant
 * violation.
 */
export function validateKanbanTemplateColumns(
  value: unknown,
): readonly KanbanTemplateColumnDef[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > KANBAN_COLUMNS_MAX) return null;

  const out: KanbanTemplateColumnDef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const name = r['name'];
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > KANBAN_COLUMN_NAME_MAX) return null;

    const stepRaw = r['stepChecklist'];
    const stepChecklist: string[] = [];
    if (stepRaw !== undefined) {
      if (!Array.isArray(stepRaw)) return null;
      if (stepRaw.length > KANBAN_STEP_CHECKLIST_MAX) return null;
      for (const v of stepRaw) {
        if (typeof v !== 'string') return null;
        const t = v.trim();
        if (t.length === 0 || t.length > KANBAN_STEP_CHECKLIST_LABEL_MAX) return null;
        stepChecklist.push(t);
      }
    }

    const id = r['id'];
    out.push({
      ...(typeof id === 'string' && id.length > 0 ? { id } : {}),
      name: trimmed,
      stepChecklist,
    });
  }
  return out;
}
