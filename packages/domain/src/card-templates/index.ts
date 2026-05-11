/**
 * Card template item definitions (PRD §6.3 ext, user spec).
 *
 * A template = an ordered list of items (inputs, sections, and an optional
 * description marker) that appear in the card modal. The card stores the
 * values keyed by input id in `Card.fieldValues`.
 */

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
 * with the existing ids in `taken`.
 */
export function generateCustomFieldId(label: string, taken: ReadonlySet<string>): string {
  const stem = slugifyFieldLabel(label) || 'field';
  let id = stem;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${stem}-${suffix}`;
    suffix++;
    if (id.length > 64) {
      // Fall back to a short random suffix; vanishingly unlikely.
      id = `${stem.slice(0, 50)}-${Math.random().toString(36).slice(2, 8)}`;
      if (!taken.has(id)) break;
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
