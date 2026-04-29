/**
 * Project domain rules (PRD §7).
 *
 * Pure TypeScript: no Prisma, no Next, no I/O.
 *  - validateProjectName / validateProjectDates
 *  - built-in Kanban templates (PRD §7.5.1) — copy-on-create per
 *    PRD §6.4 (template figé au moment de la création)
 *  - built-in project types (PRD §7.5.2)
 */

// ---------- Validation ------------------------------------------------------

import type { ValidationErr, ValidationOk } from '../clients/index';

const PROJECT_NAME_MAX = 120;

export function validateProjectName(
  raw: string,
): ValidationOk<string> | ValidationErr<'EMPTY' | 'TOO_LONG'> {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, code: 'EMPTY' };
  if (value.length > PROJECT_NAME_MAX) return { ok: false, code: 'TOO_LONG' };
  return { ok: true, value };
}

export type DateOrder =
  | { ok: true; startDate: Date | null; endDate: Date | null }
  | { ok: false; code: 'END_BEFORE_START' };

/**
 * If both dates are set, the end must not be earlier than the start.
 * Either or both being null is allowed.
 */
export function validateProjectDates(input: {
  startDate: Date | null;
  endDate: Date | null;
}): DateOrder {
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    return { ok: false, code: 'END_BEFORE_START' };
  }
  return { ok: true, startDate: input.startDate, endDate: input.endDate };
}

// ---------- Built-in project types (PRD §7 step 2) --------------------------

/** Identifiers come from the mockup `07-new-project.html` cards. */
export const BUILTIN_PROJECT_TYPES = [
  { id: 'campagne', name: 'Campagne', icon: '🎯', description: 'Plan créatif global' },
  { id: 'ongoing', name: 'Ongoing', icon: '🔄', description: 'Production en continu' },
  { id: 'lancement', name: 'Lancement', icon: '🚀', description: 'Mise sur le marché' },
  { id: 'spotTV', name: 'Spot TV', icon: '📺', description: 'Production audiovisuelle' },
  { id: 'socialMedia', name: 'Social Media', icon: '📱', description: 'Contenus réseaux' },
] as const;

export type BuiltinProjectTypeId = (typeof BUILTIN_PROJECT_TYPES)[number]['id'];

// ---------- Card category tags (PRD §6.3, mockup §04-kanban) ----------------

/**
 * Built-in card category tags. The id maps 1:1 to a Tag variant in
 * `@nexushub/ui` (design / copy / video / strategy / tiktok / insta).
 */
export const BUILTIN_CARD_CATEGORIES = [
  { id: 'design', label: 'Design' },
  { id: 'copy', label: 'Copy' },
  { id: 'video', label: 'Vidéo' },
  { id: 'strategy', label: 'Stratégie' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'insta', label: 'Insta' },
] as const;

export type BuiltinCardCategoryId = (typeof BUILTIN_CARD_CATEGORIES)[number]['id'];

export function isBuiltinCardCategory(value: unknown): value is BuiltinCardCategoryId {
  return typeof value === 'string' && BUILTIN_CARD_CATEGORIES.some((c) => c.id === value);
}

// ---------- Built-in Kanban templates (PRD §7 step 3) -----------------------

/**
 * A template defines the workflow columns *excluding* the system "Bloqué"
 * column, which is appended automatically at create time and is enforced
 * by the DB partial unique index `idx_one_blocked_per_project`.
 */
export interface KanbanTemplate {
  readonly id: string;
  readonly name: string;
  readonly recommended?: boolean;
  readonly description: string;
  readonly columns: readonly string[];
}

export const BUILTIN_TEMPLATES: readonly KanbanTemplate[] = [
  {
    id: 'creative',
    name: 'Campagne créa',
    recommended: true,
    description: 'Brief → Créa → Validation → Production → Done',
    columns: ['Brief', 'Créa', 'Validation', 'Production', 'Done'],
  },
  {
    id: 'video',
    name: 'Production vidéo',
    description: 'Pré-prod → Tournage → Montage → BAT → Livré',
    columns: ['Pré-prod', 'Tournage', 'Montage', 'BAT', 'Livré'],
  },
  {
    id: 'social',
    name: 'Social Media',
    description: 'Idéation → Rédaction → Visuel → Programmé → Posté',
    columns: ['Idéation', 'Rédaction', 'Visuel', 'Programmé', 'Posté'],
  },
  {
    id: 'standard',
    name: 'Standard',
    description: 'À faire → En cours → Validation → Done',
    columns: ['À faire', 'En cours', 'Validation', 'Done'],
  },
  {
    id: 'empty',
    name: 'Vide',
    description: 'Démarrer sans structure pré-définie',
    columns: [],
  },
] as const;

export function findTemplate(id: string): KanbanTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

/**
 * Returns the rows to insert into `columns` when creating a project. The
 * "Bloqué" system column always lives at position 9999 so a sparse
 * positional reorder of the user-facing columns never collides with it.
 */
export interface ProjectColumnSeed {
  readonly name: string;
  readonly position: number;
  readonly isBlockedSystem: boolean;
}

export const BLOCKED_COLUMN_POSITION = 9999;
export const BLOCKED_COLUMN_NAME = 'Bloqué';

/**
 * Compute the `position` to assign to a card moved into the slot of index
 * `targetIndex` within an array of existing card positions. The list is
 * assumed to already exclude the card being moved.
 *
 * Sparse 1024-step positioning means we can almost always pick the
 * midpoint between neighbours; the first / last / empty cases are
 * special-cased so positions never collide with the system Bloqué
 * column at 9999.
 */
export function computeCardPosition(input: {
  readonly orderedSiblingPositions: readonly number[];
  readonly targetIndex: number;
}): number {
  const { orderedSiblingPositions: siblings, targetIndex } = input;
  const first = siblings[0];
  if (first === undefined) return 1024;

  if (targetIndex <= 0) {
    return first > 1 ? Math.floor(first / 2) : first - 1024;
  }
  const last = siblings[siblings.length - 1];
  if (last !== undefined && targetIndex >= siblings.length) {
    return last + 1024;
  }
  const before = siblings[targetIndex - 1];
  const after = siblings[targetIndex];
  if (before === undefined || after === undefined) return 1024;
  return Math.floor((before + after) / 2);
}

export function buildProjectColumns(template: KanbanTemplate): readonly ProjectColumnSeed[] {
  // Sparse positions (1024-step) so columns can be reordered without rewriting.
  const userColumns = template.columns.map((name, idx) => ({
    name,
    position: (idx + 1) * 1024,
    isBlockedSystem: false,
  }));
  return [
    ...userColumns,
    {
      name: BLOCKED_COLUMN_NAME,
      position: BLOCKED_COLUMN_POSITION,
      isBlockedSystem: true,
    },
  ];
}
