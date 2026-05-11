/**
 * Card template field definitions (PRD §6.3 ext, user spec).
 *
 * A template = an ordered list of structured fields that appear as
 * inputs in the card modal. The card stores the values keyed by field
 * id in `Card.fieldValues` so renaming / reordering a field never
 * loses data.
 */

export type CardFieldType =
  | 'text'
  | 'longtext'
  | 'select'
  | 'link'
  | 'checkbox'
  | 'date'
  | 'number';

export type CardFieldGroup = 'overview' | 'details' | 'notes' | 'custom';

/** Where the card description block sits relative to the structured fields. */
export type CardTemplateDescriptionPosition = 'before-fields' | 'after-fields' | 'hidden';

export const DESCRIPTION_POSITIONS: readonly {
  id: CardTemplateDescriptionPosition;
  label: string;
}[] = [
  { id: 'after-fields', label: 'Après les champs' },
  { id: 'before-fields', label: 'Avant les champs' },
  { id: 'hidden', label: 'Masquée' },
];

export function isDescriptionPosition(v: unknown): v is CardTemplateDescriptionPosition {
  return v === 'before-fields' || v === 'after-fields' || v === 'hidden';
}

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
  { id: 'custom' as const, label: 'Custom' },
];

export const CARD_FIELD_TYPES: readonly { id: CardFieldType; label: string }[] = [
  { id: 'text', label: 'Texte court' },
  { id: 'longtext', label: 'Texte long' },
  { id: 'select', label: 'Liste déroulante' },
  { id: 'checkbox', label: 'Case à cocher' },
  { id: 'date', label: 'Date' },
  { id: 'number', label: 'Nombre' },
  { id: 'link', label: 'Lien URL' },
];

export function getFieldPreset(id: string): CardFieldDef | undefined {
  return CARD_FIELD_PRESETS.find((f) => f.id === id);
}

/**
 * Slugify a label down to an id stem (e.g. "Brand Voice" → "brand-voice"),
 * stripping diacritics and non-alphanumeric. Used as the deterministic part
 * of a custom field's id.
 */
export function slugifyFieldLabel(label: string): string {
  return label
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Generate a unique field id for a custom field, guaranteed not to collide
 * with the existing ids in `taken` or with any preset id.
 */
export function generateCustomFieldId(label: string, taken: ReadonlySet<string>): string {
  const stem = slugifyFieldLabel(label) || 'field';
  const reserved = new Set([...taken, ...CARD_FIELD_PRESETS.map((f) => f.id)]);
  let id = stem;
  let suffix = 2;
  while (reserved.has(id)) {
    id = `${stem}-${suffix}`;
    suffix++;
    if (id.length > 64) {
      // Fall back to a short random suffix; vanishingly unlikely.
      id = `${stem.slice(0, 50)}-${Math.random().toString(36).slice(2, 8)}`;
      if (!reserved.has(id)) break;
    }
  }
  return id;
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
    if (
      type !== 'text' &&
      type !== 'longtext' &&
      type !== 'select' &&
      type !== 'link' &&
      type !== 'checkbox' &&
      type !== 'date' &&
      type !== 'number'
    ) {
      return null;
    }
    if (typeof label !== 'string' || label.length === 0 || label.length > 120) return null;
    if (
      group !== undefined &&
      group !== 'overview' &&
      group !== 'details' &&
      group !== 'notes' &&
      group !== 'custom'
    ) {
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

// ---------- New unified items model -----------------------------------------

/** Singleton id for the description marker item. */
export const DESCRIPTION_ITEM_ID = 'description';

export type CardTemplateInputType =
  | 'text'
  | 'longtext'
  | 'select'
  | 'link'
  | 'checkbox'
  | 'date'
  | 'number';

export interface CardTemplateInputItem {
  readonly id: string;
  readonly type: CardTemplateInputType;
  readonly label: string;
  readonly options?: readonly string[];
  readonly placeholder?: string;
}

export interface CardTemplateSectionItem {
  readonly id: string;
  readonly type: 'section';
  readonly label: string;
}

export interface CardTemplateDescriptionItem {
  readonly id: typeof DESCRIPTION_ITEM_ID;
  readonly type: 'description';
}

export type CardTemplateItem =
  | CardTemplateInputItem
  | CardTemplateSectionItem
  | CardTemplateDescriptionItem;

/** Labels for the "+ Ajouter un item" popover. Order matters: it is the display order. */
export const CARD_TEMPLATE_ITEM_TYPES: readonly { id: CardTemplateItem['type']; label: string }[] =
  [
    { id: 'text', label: 'Texte court' },
    { id: 'longtext', label: 'Texte long' },
    { id: 'select', label: 'Liste déroulante' },
    { id: 'link', label: 'Lien URL' },
    { id: 'checkbox', label: 'Case à cocher' },
    { id: 'date', label: 'Date' },
    { id: 'number', label: 'Nombre' },
    { id: 'section', label: 'Section' },
    { id: 'description', label: 'Description' },
  ];

/** Default label generated when the user adds a new item, by type. */
export function defaultLabelForItemType(type: CardTemplateItem['type']): string {
  switch (type) {
    case 'text':
      return 'Nouveau champ texte';
    case 'longtext':
      return 'Nouveau champ texte long';
    case 'select':
      return 'Nouvelle liste';
    case 'link':
      return 'Nouveau lien';
    case 'checkbox':
      return 'Nouvelle case à cocher';
    case 'date':
      return 'Nouvelle date';
    case 'number':
      return 'Nouveau nombre';
    case 'section':
      return 'Nouvelle section';
    case 'description':
      return 'Description';
  }
}

// ---------- Items validator --------------------------------------------------

const ITEMS_MAX = 60;
const LABEL_MAX = 120;
const ID_MAX = 64;
const OPTIONS_MAX = 32;
const OPTION_MAX = 80;
const PLACEHOLDER_MAX = 200;

const INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'longtext',
  'select',
  'link',
  'checkbox',
  'date',
  'number',
]);

/**
 * Validate the JSONB stored in `card_templates.items`.
 * Returns `null` on the first invalid shape (caller logs / rejects).
 */
export function validateCardTemplateItems(value: unknown): readonly CardTemplateItem[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > ITEMS_MAX) return null;

  const out: CardTemplateItem[] = [];
  const seenIds = new Set<string>();
  let seenDescription = false;

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = r['id'];
    const type = r['type'];

    if (typeof id !== 'string' || id.length === 0 || id.length > ID_MAX) return null;
    if (typeof type !== 'string') return null;

    // description marker
    if (type === 'description') {
      if (id !== DESCRIPTION_ITEM_ID) return null;
      if (seenDescription) return null;
      seenDescription = true;
      out.push({ id: DESCRIPTION_ITEM_ID, type: 'description' });
      continue;
    }

    if (seenIds.has(id)) return null;
    if (id === DESCRIPTION_ITEM_ID) return null; // reserved id, only the singleton marker can use it
    seenIds.add(id);

    const label = r['label'];
    if (typeof label !== 'string') return null;
    const labelTrim = label.trim();
    if (labelTrim.length === 0 || labelTrim.length > LABEL_MAX) return null;

    if (type === 'section') {
      out.push({ id, type: 'section', label: labelTrim });
      continue;
    }

    if (!INPUT_TYPES.has(type)) return null;

    const options = r['options'];
    const placeholder = r['placeholder'];

    if (type === 'select') {
      if (!Array.isArray(options) || options.length === 0 || options.length > OPTIONS_MAX) {
        return null;
      }
      if (options.some((o) => typeof o !== 'string' || o.length === 0 || o.length > OPTION_MAX)) {
        return null;
      }
    } else if (options !== undefined) {
      // options only valid on select
      return null;
    }

    if (placeholder !== undefined) {
      if (typeof placeholder !== 'string' || placeholder.length > PLACEHOLDER_MAX) return null;
    }

    out.push({
      id,
      type: type as CardTemplateInputType,
      label: labelTrim,
      ...(Array.isArray(options) ? { options: [...(options as string[])] } : {}),
      ...(typeof placeholder === 'string' ? { placeholder } : {}),
    });
  }

  return out;
}

/**
 * Strip values keyed by ids that no longer exist or refer to non-input items
 * (section / description don't store values). Keeps per-card storage clean.
 */
export function pruneFieldValuesByItems(
  values: Record<string, unknown>,
  items: readonly CardTemplateItem[],
): Record<string, string> {
  const inputIds = new Set<string>();
  for (const it of items) {
    if (it.type !== 'section' && it.type !== 'description') inputIds.add(it.id);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (inputIds.has(k) && typeof v === 'string') out[k] = v;
  }
  return out;
}
