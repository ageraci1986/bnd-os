export const RACI_BONUS = 1.5;
const RECENCY_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function norm(s: string): string {
  return stripAccents(s.toLowerCase());
}

/**
 * True iff `query` appears as a substring in either the email or the name,
 * case- and diacritic-insensitive. Empty query never matches.
 */
export function matchesQuery(query: string, email: string, name: string | null): boolean {
  const q = norm(query.trim());
  if (q.length === 0) return false;
  if (norm(email).includes(q)) return true;
  if (name && norm(name).includes(q)) return true;
  return false;
}

export interface RankableRow {
  readonly hits: number;
  readonly lastSeenAt: string; // ISO timestamp
  readonly source: 'mail' | 'contact';
}

/**
 * Combined recency × frequency score with a fixed structured-contact bonus.
 * Higher is better. Callers pass `nowMs` explicitly so tests never touch the
 * wall clock.
 *
 * See spec §3.2. Formula:
 *   log(1 + hits)                    -- dampened frequency
 *   + 2.0 * exp(-daysSince / 30)     -- exp-decay recency, ~3 week half-life
 *   + (contact ? RACI_BONUS : 0)
 */
export function scoreRow(row: RankableRow, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - new Date(row.lastSeenAt).getTime());
  const daysSince = ageMs / MS_PER_DAY;
  const recency = 2.0 * Math.exp(-daysSince / RECENCY_HALF_LIFE_DAYS);
  const frequency = Math.log(1 + Math.max(0, row.hits));
  const bonus = row.source === 'contact' ? RACI_BONUS : 0;
  return frequency + recency + bonus;
}

export interface RecipientRow {
  readonly email: string;
  readonly name: string | null;
  readonly source: 'mail' | 'contact';
  readonly hits: number;
  readonly lastSeenAt: string;
  readonly jobTitle: string | null;
  readonly clientName: string | null;
  readonly raci: 'R' | 'A' | 'C' | 'I' | null;
}

/**
 * Merge rows that share the same email (lowercased). Contact name wins over
 * MIME fromName. Hits sum. Latest lastSeenAt wins. jobTitle/clientName/raci
 * inherit from the contact source. Preserves the FIRST occurrence's email
 * casing (arbitrary but stable).
 */
export function dedupeByEmail(rows: readonly RecipientRow[]): RecipientRow[] {
  const byKey = new Map<string, RecipientRow>();
  for (const row of rows) {
    const key = row.email.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const contactSide =
      row.source === 'contact' ? row : existing.source === 'contact' ? existing : null;
    const mailSide = row.source === 'mail' ? row : existing.source === 'mail' ? existing : null;
    byKey.set(key, {
      email: existing.email, // preserve first-seen casing
      name: contactSide?.name ?? mailSide?.name ?? existing.name,
      source: contactSide ? 'contact' : 'mail',
      hits: existing.hits + row.hits,
      lastSeenAt:
        new Date(row.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()
          ? row.lastSeenAt
          : existing.lastSeenAt,
      jobTitle: contactSide?.jobTitle ?? existing.jobTitle,
      clientName: contactSide?.clientName ?? existing.clientName,
      raci: contactSide?.raci ?? existing.raci,
    });
  }
  return Array.from(byKey.values());
}

/**
 * Permissive regex — used to visually mark chips as invalid. NOT used to
 * gate chip creation (see spec §5 — permissive Gmail-esque behavior).
 * Server-side send action does the strict `z.string().email()` check.
 */
export function isValidEmail(s: string): boolean {
  return EMAIL_REGEX.test(s.trim());
}
