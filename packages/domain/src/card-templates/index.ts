/**
 * Card template variables (PRD §6.3 ext, user spec).
 *
 * Pure-TS catalogue of the variable snippets the editor exposes as
 * "+ Insert" buttons. Each variable maps to a markdown chunk that gets
 * inserted at the cursor position in the template body.
 */

export interface CardVariable {
  readonly id: string;
  readonly group: 'overview' | 'details' | 'raci' | 'notes';
  readonly label: string;
  /** Markdown snippet inserted by the editor. Always ends with a newline. */
  readonly snippet: string;
}

export const CARD_VARIABLES: readonly CardVariable[] = [
  // — Overview ——————————————————————————————
  { id: 'objective', group: 'overview', label: 'Objective', snippet: '**Objective:** \n' },
  { id: 'deliverable', group: 'overview', label: 'Deliverable', snippet: '**Deliverable:** \n' },
  {
    id: 'outcome',
    group: 'overview',
    label: 'Outcome / KPI',
    snippet: '**Outcome / KPI:** \n',
  },

  // — Details ———————————————————————————————
  {
    id: 'task-type',
    group: 'details',
    label: 'Task Type',
    snippet: '**Task Type:** [Post / Video / Visual / Report / Event / Audit]\n',
  },
  {
    id: 'platform',
    group: 'details',
    label: 'Platform',
    snippet: '**Platform:** [Instagram / Facebook / LinkedIn / TikTok / YouTube]\n',
  },
  { id: 'due-date', group: 'details', label: 'Due date', snippet: '**Due date:** YYYY-MM-DD\n' },

  // — RACI ——————————————————————————————————
  {
    id: 'raci-r',
    group: 'raci',
    label: 'Responsible',
    snippet: '**Responsible (doer):** @\n',
  },
  {
    id: 'raci-a',
    group: 'raci',
    label: 'Accountable',
    snippet: '**Accountable (approver):** @\n',
  },
  { id: 'raci-c', group: 'raci', label: 'Consulted', snippet: '**Consulted:** @\n' },
  { id: 'raci-i', group: 'raci', label: 'Informed', snippet: '**Informed:** @\n' },

  // — Notes / Links ——————————————————————————
  { id: 'brief', group: 'notes', label: 'Brief', snippet: '**Brief:** [link or summary]\n' },
  { id: 'assets', group: 'notes', label: 'Assets', snippet: '**Assets:** [link]\n' },
  { id: 'inspiration', group: 'notes', label: 'Inspiration', snippet: '**Inspiration:** [link]\n' },
] as const;

export const CARD_VARIABLE_GROUPS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'details' as const, label: 'Details' },
  { id: 'raci' as const, label: 'RACI' },
  { id: 'notes' as const, label: 'Notes / Links' },
];

/** Reasonable starting body offered when the user creates a new template. */
export const DEFAULT_CARD_TEMPLATE_BODY = `## Overview

**Objective:**
**Deliverable:**
**Outcome / KPI:**

## Details

**Task Type:** [Post / Video / Visual / Report / Event / Audit]
**Platform:** [Instagram / Facebook / LinkedIn / TikTok / YouTube]
**Due date:** YYYY-MM-DD

## Notes / Links

**Brief:** [link or summary]
**Assets:** [link]
**Inspiration:** [link]
`;

// ---------- Validation ------------------------------------------------------

const NAME_MAX = 80;
const BODY_MAX = 16_000;

export function validateCardTemplateName(
  raw: string,
): { ok: true; value: string } | { ok: false; code: 'EMPTY' | 'TOO_LONG' } {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, code: 'EMPTY' };
  if (value.length > NAME_MAX) return { ok: false, code: 'TOO_LONG' };
  return { ok: true, value };
}

export function validateCardTemplateBody(
  raw: string,
): { ok: true; value: string } | { ok: false; code: 'TOO_LONG' } {
  const value = raw;
  if (value.length > BODY_MAX) return { ok: false, code: 'TOO_LONG' };
  return { ok: true, value };
}
