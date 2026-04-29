/**
 * Client + Contact domain rules (PRD §6.5 + §10 #14).
 *
 * Pure TypeScript: no Prisma, no Next, no I/O. Easy to unit-test, easy to
 * reuse from API actions, server components and form validation.
 */

// ---------- Color tokens ----------------------------------------------------

/** Tailwind tokens derived from `mockups/styles.css` (.cm-* gradients). */
export const CLIENT_COLOR_TOKENS = ['c-acme', 'c-tech', 'c-nova', 'c-lumen', 'c-orbit'] as const;
export type ClientColorToken = (typeof CLIENT_COLOR_TOKENS)[number];

export function isValidColorToken(value: unknown): value is ClientColorToken {
  return typeof value === 'string' && (CLIENT_COLOR_TOKENS as readonly string[]).includes(value);
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
