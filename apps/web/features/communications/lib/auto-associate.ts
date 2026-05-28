export interface DomainIndexInput {
  readonly id: string;
  readonly emailDomains: readonly string[];
}

export function buildDomainIndex(clients: readonly DomainIndexInput[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const c of clients) {
    for (const raw of c.emailDomains) {
      const d = raw.trim().toLowerCase();
      if (!d) continue;
      const list = idx.get(d);
      if (list) list.push(c.id);
      else idx.set(d, [c.id]);
    }
  }
  return idx;
}

export function matchClientByDomain(email: string, index: Map<string, string[]>): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const candidates = index.get(domain);
  if (!candidates || candidates.length === 0) return null;
  return candidates[0] ?? null;
}
