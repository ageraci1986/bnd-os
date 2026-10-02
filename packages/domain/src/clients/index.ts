/**
 * Client + Contact domain rules (PRD §6.5 + §10 #14).
 *
 * Pure TypeScript: no Prisma, no Next, no I/O. Easy to unit-test, easy to
 * reuse from API actions, server components and form validation.
 */

// ---------- Color tokens ----------------------------------------------------

/**
 * Palette workspace. Valeurs CSS dans `packages/ui/src/tokens/tokens.css`
 * (`--color-<token>`, clair + `[data-theme='dark']`). Un client peut aussi
 * porter une couleur libre `#rrggbb` (même colonne `colorToken`).
 */
export const CLIENT_COLOR_TOKENS = [
  'c-acme',
  'c-tech',
  'c-nova',
  'c-lumen',
  'c-orbit',
  'c-red',
  'c-orange',
  'c-lime',
  'c-teal',
  'c-cyan',
  'c-indigo',
  'c-slate',
] as const;
export type ClientColorToken = (typeof CLIENT_COLOR_TOKENS)[number];

export const CLIENT_COLOR_LABELS_FR: Readonly<Record<ClientColorToken, string>> = {
  'c-acme': 'Rose',
  'c-tech': 'Bleu',
  'c-nova': 'Vert',
  'c-lumen': 'Ambre',
  'c-orbit': 'Violet',
  'c-red': 'Rouge',
  'c-orange': 'Orange',
  'c-lime': 'Lime',
  'c-teal': 'Sarcelle',
  'c-cyan': 'Cyan',
  'c-indigo': 'Indigo',
  'c-slate': 'Ardoise',
};

/** Valeurs claires de `tokens.css` — utilisées uniquement pour le calcul de contraste. */
const CLIENT_TOKEN_HEX: Readonly<Record<ClientColorToken, string>> = {
  'c-acme': '#ff2a6d',
  'c-tech': '#2563eb',
  'c-nova': '#059669',
  'c-lumen': '#f59e0b',
  'c-orbit': '#8b2be2',
  'c-red': '#dc2626',
  'c-orange': '#ea580c',
  'c-lime': '#65a30d',
  'c-teal': '#0d9488',
  'c-cyan': '#0891b2',
  'c-indigo': '#4f46e5',
  'c-slate': '#475569',
};

const CLIENT_HEX_RE = /^#[0-9a-f]{6}$/;

export function isValidColorToken(value: unknown): value is ClientColorToken {
  return typeof value === 'string' && (CLIENT_COLOR_TOKENS as readonly string[]).includes(value);
}

/** Token de la palette OU couleur libre `#rrggbb` (minuscules). */
export function isValidClientColor(value: unknown): value is string {
  return isValidColorToken(value) || (typeof value === 'string' && CLIENT_HEX_RE.test(value));
}

/** Valeur CSS sûre à injecter dans un `style` (jamais la chaîne brute si invalide). */
export function clientColorCss(value: string): string {
  if (isValidColorToken(value)) return `var(--color-${value})`;
  if (CLIENT_HEX_RE.test(value)) return value;
  return 'var(--color-c-acme)';
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Noir ou blanc, celui qui offre le meilleur contraste WCAG sur la couleur du client. */
export function clientColorForeground(value: string): '#000000' | '#ffffff' {
  const hex = isValidColorToken(value)
    ? CLIENT_TOKEN_HEX[value]
    : CLIENT_HEX_RE.test(value)
      ? value
      : null;
  if (hex === null) return '#ffffff';
  const l = relativeLuminance(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastBlack = (l + 0.05) / 0.05;
  return contrastBlack > contrastWhite ? '#000000' : '#ffffff';
}

// ---------- Initials --------------------------------------------------------

/**
 * Derive a 1-2 char initials string from a client name (e.g. "Acme Brands" → "AB").
 * Used to seed the form so the user only has to override when the default is wrong.
 */
export function computeInitials(name: string): string {
  const stripped = name
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/g, '') // strip diacritics
    .trim();
  if (stripped.length === 0) return '';

  const words = stripped.split(/\s+/u).filter((w) => /[A-Za-z0-9]/u.test(w));
  const [first, second] = words;
  if (!first) return '';
  if (!second) return first.slice(0, 2).toUpperCase();
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

// ---------- Validation ------------------------------------------------------

export interface ValidationOk<T> {
  readonly ok: true;
  readonly value: T;
}
export interface ValidationErr<C extends string> {
  readonly ok: false;
  readonly code: C;
}

const CLIENT_NAME_MAX = 80;

export function validateClientName(
  raw: string,
): ValidationOk<string> | ValidationErr<'EMPTY' | 'TOO_LONG'> {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, code: 'EMPTY' };
  if (value.length > CLIENT_NAME_MAX) return { ok: false, code: 'TOO_LONG' };
  return { ok: true, value };
}

const INITIALS_RE = /^[A-Z0-9]{1,4}$/u;

export function validateInitials(
  raw: string,
): ValidationOk<string> | ValidationErr<'EMPTY' | 'TOO_LONG' | 'INVALID_CHARS'> {
  const value = raw.trim().toUpperCase();
  if (value.length === 0) return { ok: false, code: 'EMPTY' };
  if (value.length > 4) return { ok: false, code: 'TOO_LONG' };
  if (!INITIALS_RE.test(value)) return { ok: false, code: 'INVALID_CHARS' };
  return { ok: true, value };
}

export function validateContactName(input: {
  firstName: string;
  lastName: string;
}):
  | ValidationOk<{ firstName: string; lastName: string }>
  | ValidationErr<'FIRST_NAME_EMPTY' | 'LAST_NAME_EMPTY'> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (firstName.length === 0) return { ok: false, code: 'FIRST_NAME_EMPTY' };
  if (lastName.length === 0) return { ok: false, code: 'LAST_NAME_EMPTY' };
  return { ok: true, value: { firstName, lastName } };
}

// ---------- Email domains (used for Exchange auto-association) -------------

const DOMAIN_LABEL_CHAR = /^[a-z0-9-]+$/u;

function isValidDomainLabel(label: string): boolean {
  if (label.length === 0 || label.length > 63) return false;
  if (label.startsWith('-') || label.endsWith('-')) return false;
  return DOMAIN_LABEL_CHAR.test(label);
}

export function normalizeDomain(raw: string): string {
  let v = raw.trim().toLowerCase();
  if (v.startsWith('@')) v = v.slice(1);
  v = v.replace(/^https?:\/\//u, '');
  v = v.split('/')[0] ?? '';
  return v;
}

function isValidDomain(domain: string): boolean {
  if (domain.length === 0 || domain.length > 253) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every(isValidDomainLabel);
}

export function parseDomainList(
  raw: string,
): ValidationOk<readonly string[]> | ValidationErr<'INVALID_DOMAIN'> {
  if (raw.trim().length === 0) return { ok: true, value: [] };
  const parts = raw
    .split(/[,\s]+/u)
    .map((s) => normalizeDomain(s))
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of parts) {
    if (!isValidDomain(d)) return { ok: false, code: 'INVALID_DOMAIN' };
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return { ok: true, value: out };
}

// ---------- RACI ------------------------------------------------------------

/** Mirrors the Prisma `RACI` enum. */
export const RACI_VALUES = ['responsible', 'approver', 'consulted', 'informed'] as const;
export type Raci = (typeof RACI_VALUES)[number];

export function isValidRaci(value: unknown): value is Raci {
  return typeof value === 'string' && (RACI_VALUES as readonly string[]).includes(value);
}

const RACI_LETTER: Record<Raci, string> = {
  responsible: 'R',
  approver: 'A',
  consulted: 'C',
  informed: 'I',
};

export function raciLabelFr(raci: Raci): string {
  return RACI_LETTER[raci];
}

/** Map RACI → Tag variant from `packages/ui` (PRD §6.6 colour rules). */
export type RaciTagVariant = 'info' | 'warning' | 'success' | 'neutral';

const RACI_VARIANT: Record<Raci, RaciTagVariant> = {
  responsible: 'info', // bleu
  approver: 'warning', // ambre
  consulted: 'success', // vert
  informed: 'neutral', // gris
};

export function raciTagVariant(raci: Raci): RaciTagVariant {
  return RACI_VARIANT[raci];
}

// ---------- Deletion guard (PRD §10 #14) ------------------------------------

export type CanDeleteClientResult =
  | { ok: true }
  | { ok: false; code: 'HAS_ACTIVE_PROJECTS'; activeProjectsCount: number };

export function canDeleteClient(input: { activeProjectsCount: number }): CanDeleteClientResult {
  if (input.activeProjectsCount > 0) {
    return {
      ok: false,
      code: 'HAS_ACTIVE_PROJECTS',
      activeProjectsCount: input.activeProjectsCount,
    };
  }
  return { ok: true };
}
