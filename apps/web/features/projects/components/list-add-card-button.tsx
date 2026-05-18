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
  /**
   * - `dashed` (default): full-width dashed pill matching the Kanban
   *   column's `add-card-btn`. Rendered below the cards of a section.
   * - `primary`: filled gradient pill, intended for a single
   *   prominent top-of-page CTA.
   */
  readonly variant?: 'dashed' | 'primary';
  /** Override the default label (esp. for the primary CTA). */
  readonly label?: string;
}

/**
 * Per-column "+ Ajouter une carte" button used in the list view. Same
 * optimistic UUID + modal-open + rollback flow as the Kanban column
 * add button, just with a style hook that adapts the visual depending
 * on placement.
 */
export function ListAddCardButton({
  projectId,
  columnId,
  columnName,
  csrfToken,
  variant = 'dashed',
  label,
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

  const className = variant === 'primary' ? 'btn btn-primary' : 'add-card-btn';
  const defaultLabel = variant === 'primary' ? '+ Nouvelle carte' : '+ Ajouter une carte';
  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={pending}
      className={className}
      aria-label={`Ajouter une carte dans ${columnName}`}
    >
      {pending ? 'Création…' : (label ?? defaultLabel)}
    </button>
  );
}
