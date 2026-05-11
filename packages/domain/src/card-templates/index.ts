/**
 * Card template field definitions (PRD §6.3 ext, user spec).
 *
 * A template = an ordered list of structured fields that appear as
 * inputs in the card modal. The card stores the values keyed by field
 * id in `Card.fieldValues` so renaming / reordering a field never
 * loses data.
 */

export type CardFieldType = 'text' | 'longtext' | 'select' | 'link';

export type CardFieldGroup = 'overview' | 'details' | 'notes';

export interface CardFieldDef {
  readonly id: string;
  readonly type: CardFieldType;
  readonly label: string;
  readonly group?: CardFieldGroup;
  readonly options?: readonly string[];
  readonly placeholder?: string;
}

/**
 * Preset fields the editor exposes as "+ Add field" quick picks.
 * Values are the user's spec verbatim. Custom fields (V1.5) will be
 * built on top of the same shape.
 */
export const CARD_FIELD_PRESETS: readonly CardFieldDef[] = [
  // — Overview ——————————————————————————————
  {
    id: 'objective',
    type: 'longtext',
    label: 'Objective',
    group: 'overview',
    placeholder: 'What is this card achieving?',
  },
  {
    id: 'deliverable',
    type: 'longtext',
    label: 'Deliverable',
    group: 'overview',
    placeholder: 'What will be produced?',
  },
  {
    id: 'outcome',
    type: 'longtext',
    label: 'Outcome / KPI',
    group: 'overview',
    placeholder: 'How is success measured?',
  },

  // — Details ———————————————————————————————
  {
    id: 'task-type',
    type: 'select',
    label: 'Task Type',
    group: 'details',
    options: ['Post', 'Video', 'Visual', 'Report', 'Event', 'Audit'],
  },
  {
    id: 'platform',
    type: 'select',
    label: 'Platform',
    group: 'details',
    options: ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube'],
  },

  // — Notes / Links ——————————————————————————
  {
    id: 'brief',
    type: 'link',
    label: 'Brief',
    group: 'notes',
    placeholder: 'https://… (or short summary)',
  },
  {
    id: 'assets',
    type: 'link',
    label: 'Assets',
    group: 'notes',
    placeholder: 'https://…',
  },
  {
    id: 'inspiration',
    type: 'link',
    label: 'Inspiration',
    group: 'notes',
    placeholder: 'https://…',
  },
];

export const CARD_FIELD_GROUPS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'details' as const, label: 'Details' },
  { id: 'notes' as const, label: 'Notes / Links' },
];

export function getFieldPreset(id: string): CardFieldDef | undefined {
  return CARD_FIELD_PRESETS.find((f) => f.id === id);
}

// ---------- Validation ------------------------------------------------------

const NAME_MAX = 80;

export function validateCardTemplateName(
  raw: string,
): { ok: true; value: string } | { ok: false; code: 'EMPTY' | 'TOO_LONG' } {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, code: 'EMPTY' };
  if (value.length > NAME_MAX) return { ok: false, code: 'TOO_LONG' };
  return { ok: true, value };
}

/**
 * Strict runtime check used at the action boundary so a malformed JSON
 * blob can't slip into the DB. Returns `null` on the first invalid
 * shape rather than partial data — the caller logs / rejects.
 */
export function validateCardFields(value: unknown): readonly CardFieldDef[] | null {
  if (!Array.isArray(value)) return null;
  const out: CardFieldDef[] = [];
  const seenIds = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const f = raw as Record<string, unknown>;
    const id = f['id'];
    const type = f['type'];
    const label = f['label'];
    const group = f['group'];
    const options = f['options'];
    const placeholder = f['placeholder'];
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
    if (seenIds.has(id)) return null;
    seenIds.add(id);
    if (type !== 'text' && type !== 'longtext' && type !== 'select' && type !== 'link') {
      return null;
    }
    if (typeof label !== 'string' || label.length === 0 || label.length > 120) return null;
    if (group !== undefined && group !== 'overview' && group !== 'details' && group !== 'notes') {
      return null;
    }
    if (options !== undefined) {
      if (!Array.isArray(options) || options.length === 0 || options.length > 32) return null;
      if (options.some((o) => typeof o !== 'string' || o.length === 0 || o.length > 80)) {
        return null;
      }
    }
    if (placeholder !== undefined) {
      if (typeof placeholder !== 'string' || placeholder.length > 200) return null;
    }
    out.push({
      id,
      type,
      label,
      ...(group ? { group: group as CardFieldGroup } : {}),
      ...(Array.isArray(options) ? { options: [...(options as string[])] } : {}),
      ...(typeof placeholder === 'string' ? { placeholder } : {}),
    });
  }
  return out;
}

/**
 * Strip values keyed by field ids that no longer exist (e.g. a field
 * was removed from the template). Keeps the per-card storage clean.
 */
export function pruneFieldValues(
  values: Record<string, unknown>,
  fields: readonly CardFieldDef[],
): Record<string, string> {
  const known = new Set(fields.map((f) => f.id));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (known.has(k) && typeof v === 'string') out[k] = v;
  }
  return out;
}
