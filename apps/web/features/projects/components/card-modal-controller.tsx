'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CardModal } from './card-modal';
import { getCardModalData, type CardModalData } from '../actions/get-card-modal-data';
import type { WorkspaceMemberOption, CardAssignment } from './assignees-side';
import type { TemplateOption } from './template-picker';

/**
 * Custom event dispatched by KanbanCard when the user clicks a row.
 * Carries the row data we already have so the modal can mount instantly
 * with a header skeleton while the full detail loads in the background.
 */
export const OPEN_CARD_EVENT = 'nx:open-card' as const;

export interface OpenCardEventDetail {
  readonly id: string;
  readonly title: string;
  readonly shortRef: number;
  readonly categoryTag: string | null;
  /** When true, the title input autoselects on open (new-card flow). */
  readonly isNew?: boolean;
}

/**
 * Custom event dispatched optimistically the moment a new card is
 * created. The KanbanBoard listens and appends the row to its local
 * copy so the user sees it instantly, before the server round-trip
 * resolves.
 */
export const CARD_CREATED_EVENT = 'nx:card-created' as const;

export interface CardCreatedEventDetail {
  readonly id: string;
  readonly columnId: string;
  readonly shortRef: number;
  readonly title: string;
  readonly categoryTag: string | null;
}

/**
 * Rollback the optimistic create when the server fails.
 */
export const CARD_REMOVED_EVENT = 'nx:card-removed' as const;

export interface CardRemovedEventDetail {
  readonly id: string;
}

/**
 * Close the open modal from outside (e.g. on create failure).
 */
export const CLOSE_CARD_EVENT = 'nx:close-card' as const;

/**
 * Server assigned the real shortRef for an optimistic card — patch
 * both the board row and the open modal so the user sees the real
 * reference number.
 */
export const CARD_SHORTREF_RESOLVED_EVENT = 'nx:card-shortref-resolved' as const;

export interface CardShortRefResolvedEventDetail {
  readonly id: string;
  readonly shortRef: number;
}

/**
 * Click-to-advance shortcut: a view-level component (kanban-board,
 * list-view) listens and moves the card into the next user column in
 * its local optimistic state. Server has already accepted the move.
 */
export const CARD_ADVANCED_EVENT = 'nx:card-advanced' as const;

export interface CardAdvancedEventDetail {
  readonly id: string;
  readonly newColumnId: string;
}

export interface CardModalControllerProps {
  readonly csrfToken: string;
  readonly workspaceName: string;
  readonly projectName: string;
  readonly customCategories: readonly string[];
  readonly workspaceMembers: readonly WorkspaceMemberOption[];
  readonly availableTemplates: readonly TemplateOption[];
  /** Card detail prefetched server-side when the URL contained `?card=…`
   *  on initial load. After mount the controller takes over completely. */
  readonly initialCard: CardModalData | null;
  /** When true (URL had ?new=1), the modal autoselects the title. */
  readonly initialIsNew: boolean;
  /** When true, the rendered modal disables every mutation control
   *  (Viewer role). The page passes `ctx.role === Roles.Viewer`. */
  readonly isReadOnly?: boolean;
}

interface ModalState {
  readonly id: string;
  /** Filled while we wait for the server detail to arrive. */
  readonly skeleton: OpenCardEventDetail | null;
  readonly data: CardModalData | null;
  readonly isNew: boolean;
}

/**
 * Owns the modal open/close + detail fetch entirely client-side so the
 * page RSC is not re-fetched on every click. The URL stays in sync via
 * history.replaceState (no Next router involvement → no RSC roundtrip).
 *
 * Initial state may come from page server props (share-link reload).
 */
export function CardModalController({
  csrfToken,
  workspaceName,
  projectName,
  customCategories,
  workspaceMembers,
  availableTemplates,
  initialCard,
  initialIsNew,
  isReadOnly = false,
}: CardModalControllerProps) {
  const pathname = usePathname();
  const [state, setState] = useState<ModalState | null>(
    initialCard
      ? { id: initialCard.id, skeleton: null, data: initialCard, isNew: initialIsNew }
      : null,
  );

  // Sync the URL silently — keeps share-links working without triggering RSC.
  const syncUrl = useCallback((cardId: string | null) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (cardId) url.searchParams.set('card', cardId);
    else url.searchParams.delete('card');
    url.searchParams.delete('new');
    const next = url.pathname + (url.search ? url.search : '');
    window.history.replaceState(null, '', next);
  }, []);

  // Drop the ?new=1 token once consumed so a refresh doesn't keep
  // re-selecting the title.
  useEffect(() => {
    if (initialIsNew) syncUrl(initialCard?.id ?? null);
  }, [initialIsNew, initialCard?.id, syncUrl]);

  const open = useCallback(
    (detail: OpenCardEventDetail) => {
      setState({ id: detail.id, skeleton: detail, data: null, isNew: detail.isNew ?? false });
      syncUrl(detail.id);

      // For optimistic new-card opens the row may not exist server-side
      // yet (createCard is in flight). We still want to fetch the detail
      // — that's how we pick up the default template's items + description
      // — so we retry with a short backoff until the row materialises.
      const maxAttempts = detail.isNew ? 8 : 1;
      const baseDelayMs = detail.isNew ? 150 : 0;
      let attempt = 0;
      const tryFetch = (): void => {
        void getCardModalData({ cardId: detail.id })
          .then((res) => {
            if (res.ok) {
              setState((prev) =>
                prev && prev.id === detail.id ? { ...prev, data: res.data } : prev,
              );
              return;
            }
            attempt++;
            if (attempt >= maxAttempts) {
              // Existing-card open: bubble up. New-card open: silently give
              // up so the modal stays usable (user can still type the title;
              // save will succeed once createCard lands).
              if (!detail.isNew) {
                window.alert(res.message);
                setState(null);
                syncUrl(null);
              }
              return;
            }
            setTimeout(tryFetch, baseDelayMs * Math.pow(1.5, attempt - 1));
          })
          .catch(() => {
            setState(null);
            syncUrl(null);
          });
      };
      if (baseDelayMs === 0) tryFetch();
      else setTimeout(tryFetch, baseDelayMs);
    },
    [syncUrl],
  );

  const close = useCallback(() => {
    setState(null);
    syncUrl(null);
  }, [syncUrl]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenCardEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      open(detail);
    };
    const onClose = () => close();
    const onShortRef = (e: Event) => {
      const detail = (e as CustomEvent<CardShortRefResolvedEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      setState((prev) => {
        if (!prev || prev.id !== detail.id) return prev;
        const patchedData: CardModalData | null = prev.data
          ? { ...prev.data, shortRef: detail.shortRef }
          : null;
        const patchedSkeleton: OpenCardEventDetail | null = prev.skeleton
          ? { ...prev.skeleton, shortRef: detail.shortRef }
          : null;
        return { ...prev, skeleton: patchedSkeleton, data: patchedData };
      });
    };
    window.addEventListener(OPEN_CARD_EVENT, onOpen);
    window.addEventListener(CLOSE_CARD_EVENT, onClose);
    window.addEventListener(CARD_SHORTREF_RESOLVED_EVENT, onShortRef);
    return () => {
      window.removeEventListener(OPEN_CARD_EVENT, onOpen);
      window.removeEventListener(CLOSE_CARD_EVENT, onClose);
      window.removeEventListener(CARD_SHORTREF_RESOLVED_EVENT, onShortRef);
    };
  }, [open, close]);

  // Reset state if the user navigates between projects while a modal is
  // open (initialCard prop changes from null because the new project's
  // RSC didn't carry a card).
  useEffect(() => {
    if (!initialCard) return;
    setState({ id: initialCard.id, skeleton: null, data: initialCard, isNew: initialIsNew });
  }, [initialCard, initialIsNew]);

  // Pathname changes (between projects) → drop any stale open card.
  useEffect(() => {
    setState((prev) => (prev && !initialCard ? null : prev));
  }, [pathname, initialCard]);

  if (!state) return null;

  // While the detail is loading, build a minimal CardModal payload from
  // the row skeleton so the user sees the header instantly.
  const cardForModal =
    state.data ??
    ({
      id: state.id,
      title: state.skeleton?.title ?? '…',
      description: null,
      dueDate: null,
      shortRef: state.skeleton?.shortRef ?? 0,
      columnId: '',
      columnName: '',
      columnIsBlocked: false,
      nextColumnName: null,
      categoryTag: state.skeleton?.categoryTag ?? null,
      checklist: [],
      assignees: [] as readonly CardAssignment[],
      templateId: null,
      templateItems: [],
      fieldValues: {},
      comments: [],
    } satisfies CardModalData);

  return (
    <CardModal
      csrfToken={csrfToken}
      workspaceName={workspaceName}
      projectName={projectName}
      customCategories={customCategories}
      isNew={state.isNew}
      workspaceMembers={workspaceMembers}
      availableTemplates={availableTemplates}
      card={cardForModal}
      onClose={close}
      isLoading={state.data === null}
      isReadOnly={isReadOnly}
    />
  );
}
