/**
 * Filtre client global (PRD §8.1) — passé en URL et stocké côté client.
 * Logique pure : pas de dépendance Next/Zustand.
 */
export type ClientFilter =
  | { readonly mode: 'all' }
  | { readonly mode: 'single'; readonly clientId: string };

export const ALL_CLIENTS: ClientFilter = Object.freeze({ mode: 'all' });

export function selectClient(clientId: string): ClientFilter {
  if (!clientId) throw new Error('clientId is required');
  return { mode: 'single', clientId };
}

export function clearClient(): ClientFilter {
  return ALL_CLIENTS;
}

export function isFilteredBy(filter: ClientFilter, clientId: string): boolean {
  return filter.mode === 'single' && filter.clientId === clientId;
}

export function toQueryParam(filter: ClientFilter): string | null {
  return filter.mode === 'single' ? filter.clientId : null;
}

export function fromQueryParam(value: string | null | undefined): ClientFilter {
  if (!value) return ALL_CLIENTS;
  return selectClient(value);
}
