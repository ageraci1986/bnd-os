'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_LIST_VIEW_FIELDS,
  isListViewFieldId,
  type ListViewFieldId,
} from './list-view-fields';

/**
 * Per-project persistent selection of which optional columns to show
 * in the Liste view. Stored in localStorage so it survives reloads
 * without a server round-trip. (Cross-device sync is out of scope V1.)
 */
export function useListViewColumns(projectId: string) {
  const storageKey = `nx:list-cols:${projectId}`;

  // SSR + first paint: render with defaults to avoid flashes — then
  // reconcile against localStorage on mount.
  const [selected, setSelected] = useState<readonly ListViewFieldId[]>(DEFAULT_LIST_VIEW_FIELDS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter(isListViewFieldId);
          setSelected(cleaned);
        }
      }
    } catch {
      // Corrupted / blocked storage — keep defaults.
    }
    setHydrated(true);
  }, [storageKey]);

  const toggle = useCallback(
    (id: ListViewFieldId) => {
      setSelected((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        if (hydrated) {
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            // ignore quota / private-mode errors
          }
        }
        return next;
      });
    },
    [hydrated, storageKey],
  );

  const reset = useCallback(() => {
    setSelected(DEFAULT_LIST_VIEW_FIELDS);
    if (hydrated) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }, [hydrated, storageKey]);

  return { selected, toggle, reset } as const;
}
