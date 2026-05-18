'use client';
import { useTransition } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { createCard } from '../actions/create-card';
import {
  CARD_CREATED_EVENT,
  CARD_REMOVED_EVENT,
  CARD_SHORTREF_RESOLVED_EVENT,
  CLOSE_CARD_EVENT,
  OPEN_CARD_EVENT,
  type CardCreatedEventDetail,
  type OpenCardEventDetail,
} from './card-modal-controller';

const PLACEHOLDER_TITLE = 'Nouvelle carte';

export interface ListAddCardButtonProps {
  readonly projectId: string;
  readonly columnId: string;
  readonly columnName: string;
  readonly csrfToken: string;
}

/**
 * Compact per-column "+ Ajouter" button rendered next to each list-view
 * section header. Mirrors the Kanban column's add flow: same optimistic
 * UUID, same modal open + rollback events, just rendered inline in the
 * list rather than as the full pill button at the bottom of a column.
 */
export function ListAddCardButton({
  projectId,
  columnId,
  columnName,
  csrfToken,
}: ListAddCardButtonProps) {
  const [pending, startTransition] = useTransition();

  const handleAdd = () => {
    const optimisticId = crypto.randomUUID();

    const created: CardCreatedEventDetail = {
      id: optimisticId,
      columnId,
      shortRef: 0,
      title: PLACEHOLDER_TITLE,
      categoryTag: null,
    };
    window.dispatchEvent(new CustomEvent(CARD_CREATED_EVENT, { detail: created }));

    const open: OpenCardEventDetail = {
      id: optimisticId,
      title: PLACEHOLDER_TITLE,
      shortRef: 0,
      categoryTag: null,
      isNew: true,
    };
    window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail: open }));

    const fd = new FormData();
    fd.set(CSRF_FIELD_NAME, csrfToken);
    fd.set('projectId', projectId);
    fd.set('columnId', columnId);
    fd.set('title', PLACEHOLDER_TITLE);
    fd.set('proposedId', optimisticId);

    startTransition(async () => {
      const res = await createCard({ status: 'idle' }, fd);
      if (res.status === 'error') {
        window.dispatchEvent(new CustomEvent(CARD_REMOVED_EVENT, { detail: { id: optimisticId } }));
        window.dispatchEvent(new CustomEvent(CLOSE_CARD_EVENT));
        window.alert(res.message);
      } else if (res.status === 'success' && res.shortRef !== 0) {
        window.dispatchEvent(
          new CustomEvent(CARD_SHORTREF_RESOLVED_EVENT, {
            detail: { id: res.cardId, shortRef: res.shortRef },
          }),
        );
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={pending}
      className="ml-auto rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)] transition hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-text-main)] disabled:opacity-50"
      aria-label={`Ajouter une carte dans ${columnName}`}
    >
      {pending ? '…' : '+ Ajouter'}
    </button>
  );
}
