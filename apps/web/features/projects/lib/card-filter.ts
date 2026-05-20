import type { Prisma } from '@nexushub/db';
import { startOfTodayInParis } from '@nexushub/domain';

/**
 * Project-scoped card filter — shared by the three project views
 * (Kanban / Liste / Calendrier) so a filter set in one view follows
 * the user when they switch view via the toggle. The state lives in
 * URL params for shareable / bookmarkable URLs; the column-picker
 * preference stays in localStorage because it's personal, not shared.
 *
 * URL keys (all optional):
 *   q   — full-text on title + numeric matches on shortRef
 *   col — comma-separated column ids (UUIDs)
 *   cat — comma-separated category tags (built-in id or custom label)
 *   asg — comma-separated assignee user ids (UUIDs)
 *   tpl — comma-separated card-template ids (UUIDs)
 *   due — 'today' | 'week' | 'overdue' | 'none' | 'YYYY-MM-DD..YYYY-MM-DD'
 */

export type DueFilter =
  | { readonly mode: 'all' }
  | { readonly mode: 'today' | 'week' | 'overdue' | 'none' }
  | { readonly mode: 'range'; readonly from: string; readonly to: string };

export interface ProjectCardFilter {
  readonly q: string;
  readonly columnIds: readonly string[];
  readonly categoryTags: readonly string[];
  readonly assigneeIds: readonly string[];
  readonly templateIds: readonly string[];
  readonly due: DueFilter;
}

export const EMPTY_PROJECT_CARD_FILTER: ProjectCardFilter = {
  q: '',
  columnIds: [],
  categoryTags: [],
  assigneeIds: [],
  templateIds: [],
  due: { mode: 'all' },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CSV_ITEMS = 50;
const MAX_TAG_LEN = 80;
const MAX_Q_LEN = 200;

type SpLike = URLSearchParams | Record<string, string | string[] | undefined>;

function readKey(sp: SpLike, k: string): string | null {
  if (sp instanceof URLSearchParams) return sp.get(k);
  const v = sp[k];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

function csvUuids(raw: string | null): readonly string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s))
    .slice(0, MAX_CSV_ITEMS);
}

function csvSafe(raw: string | null): readonly string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (s.length > 0 && s.length <= MAX_TAG_LEN && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
    if (out.length >= MAX_CSV_ITEMS) break;
  }
  return out;
}

function parseDue(raw: string | null): DueFilter {
  if (raw === 'today' || raw === 'week' || raw === 'overdue' || raw === 'none') {
    return { mode: raw };
  }
  if (raw && raw.includes('..')) {
    const [from, to] = raw.split('..');
    if (from && to && DATE_RE.test(from) && DATE_RE.test(to) && from <= to) {
      return { mode: 'range', from, to };
    }
  }
  return { mode: 'all' };
}

export function parseProjectCardFilter(sp: SpLike): ProjectCardFilter {
  return {
    q: (readKey(sp, 'q') ?? '').trim().slice(0, MAX_Q_LEN),
    columnIds: csvUuids(readKey(sp, 'col')),
    categoryTags: csvSafe(readKey(sp, 'cat')),
    assigneeIds: csvUuids(readKey(sp, 'asg')),
    templateIds: csvUuids(readKey(sp, 'tpl')),
    due: parseDue(readKey(sp, 'due')),
  };
}

/**
 * Mutate a copy of `current` to reflect `filter` — leaves other params
 * (?client=, ?month=, ?card=) untouched so view-toggle / modal state
 * survive when the filter changes.
 */
export function writeProjectCardFilter(
  current: URLSearchParams,
  filter: ProjectCardFilter,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const setOrDelete = (k: string, v: string) => {
    if (v) next.set(k, v);
    else next.delete(k);
  };
  setOrDelete('q', filter.q.trim());
  setOrDelete('col', filter.columnIds.join(','));
  setOrDelete('cat', filter.categoryTags.join(','));
  setOrDelete('asg', filter.assigneeIds.join(','));
  setOrDelete('tpl', filter.templateIds.join(','));
  setOrDelete(
    'due',
    filter.due.mode === 'all'
      ? ''
      : filter.due.mode === 'range'
        ? `${filter.due.from}..${filter.due.to}`
        : filter.due.mode,
  );
  return next;
}

export function activeFilterCount(f: ProjectCardFilter): number {
  let n = 0;
  if (f.q.trim().length > 0) n += 1;
  if (f.columnIds.length > 0) n += 1;
  if (f.categoryTags.length > 0) n += 1;
  if (f.assigneeIds.length > 0) n += 1;
  if (f.templateIds.length > 0) n += 1;
  if (f.due.mode !== 'all') n += 1;
  return n;
}

export function isProjectCardFilterEmpty(f: ProjectCardFilter): boolean {
  return activeFilterCount(f) === 0;
}

// ---------- Prisma `where` builder ---------------------------------------

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function buildDueWhere(due: DueFilter): Prisma.CardWhereInput | null {
  if (due.mode === 'all') return null;
  if (due.mode === 'none') return { dueDate: null };
  if (due.mode === 'today') {
    const start = startOfTodayUtc();
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { dueDate: { gte: start, lt: end } };
  }
  if (due.mode === 'week') {
    const start = startOfTodayUtc();
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { dueDate: { gte: start, lt: end } };
  }
  if (due.mode === 'overdue') {
    return { dueDate: { lt: startOfTodayInParis() } };
  }
  if (due.mode === 'range') {
    const from = new Date(`${due.from}T00:00:00.000Z`);
    const to = new Date(`${due.to}T00:00:00.000Z`);
    to.setUTCDate(to.getUTCDate() + 1);
    return { dueDate: { gte: from, lt: to } };
  }
  return null;
}

export interface BuildCardWhereOptions {
  readonly workspaceId: string;
  readonly projectId: string;
  /**
   * Optional extra constraints merged with the filter (e.g. calendar
   * range, deletedAt: null is added implicitly). Callers can also pass
   * `dueDate` here — it's preserved unless the filter explicitly sets
   * a `due` mode, in which case the filter wins.
   */
  readonly extra?: Prisma.CardWhereInput;
}

/**
 * Just the filter-derived clauses — meant to be spread into a parent
 * `where` that already scopes by workspace / project / deletedAt
 * (e.g. inside a nested `cards: { where: ... }` include).
 */
export function buildCardFilterClauses(filter: ProjectCardFilter): Prisma.CardWhereInput {
  const where: Prisma.CardWhereInput = {};
  const q = filter.q.trim();
  if (q.length > 0) {
    const ors: Prisma.CardWhereInput[] = [{ title: { contains: q, mode: 'insensitive' } }];
    const numeric = Number(q.replace(/^#/, ''));
    if (Number.isFinite(numeric) && Number.isInteger(numeric) && numeric > 0) {
      ors.push({ shortRef: numeric });
    }
    where.OR = ors;
  }
  if (filter.columnIds.length > 0) where.columnId = { in: [...filter.columnIds] };
  if (filter.categoryTags.length > 0) where.categoryTag = { in: [...filter.categoryTags] };
  if (filter.assigneeIds.length > 0) {
    where.assignees = { some: { userId: { in: [...filter.assigneeIds] } } };
  }
  if (filter.templateIds.length > 0) where.templateId = { in: [...filter.templateIds] };
  const dueWhere = buildDueWhere(filter.due);
  if (dueWhere) Object.assign(where, dueWhere);
  return where;
}

export function buildCardWhere(
  filter: ProjectCardFilter,
  opts: BuildCardWhereOptions,
): Prisma.CardWhereInput {
  return {
    ...opts.extra,
    ...buildCardFilterClauses(filter),
    workspaceId: opts.workspaceId,
    projectId: opts.projectId,
    deletedAt: null,
  };
}
