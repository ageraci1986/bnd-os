'use client';
import { useOptimistic, useTransition } from 'react';
import { CardCommentItem } from './card-comment-item';
import { CardCommentForm } from './card-comment-form';
import type { CardCommentDTO } from '../lib/comment-dto';

export interface CardCommentsThreadProps {
  readonly cardId: string;
  readonly csrfToken: string;
  readonly comments: readonly CardCommentDTO[];
  /** Hide the "post a comment" form when the modal is in read-only mode. */
  readonly canPost?: boolean;
}

type OptimisticAction =
  | { type: 'add'; comment: CardCommentDTO }
  | { type: 'update'; id: string; body: string; bodyHtml: string }
  | { type: 'delete'; id: string };

function commentsReducer(
  state: readonly CardCommentDTO[],
  action: OptimisticAction,
): readonly CardCommentDTO[] {
  switch (action.type) {
    case 'add':
      // Avoid duplicates if the server-truth prop catches up before the
      // optimistic item is removed.
      return state.some((c) => c.id === action.comment.id) ? state : [...state, action.comment];
    case 'update':
      return state.map((c) =>
        c.id === action.id
          ? { ...c, body: action.body, bodyHtml: action.bodyHtml, isEdited: true }
          : c,
      );
    case 'delete':
      return state.filter((c) => c.id !== action.id);
  }
}

export function CardCommentsThread({
  cardId,
  csrfToken,
  comments,
  canPost = true,
}: CardCommentsThreadProps) {
  const [, startTransition] = useTransition();
  const [optimisticComments, dispatch] = useOptimistic(comments, commentsReducer);

  const applyAdd = (comment: CardCommentDTO) => {
    startTransition(() => {
      dispatch({ type: 'add', comment });
    });
  };

  const applyUpdate = (id: string, body: string, bodyHtml: string) => {
    startTransition(() => {
      dispatch({ type: 'update', id, body, bodyHtml });
    });
  };

  const applyDelete = (id: string) => {
    startTransition(() => {
      dispatch({ type: 'delete', id });
    });
  };

  return (
    <section className="nx-comments" aria-labelledby="nx-comments-title">
      <h3 id="nx-comments-title" className="nx-comments__title">
        Commentaires ({optimisticComments.length})
      </h3>
      {optimisticComments.length === 0 ? (
        <p className="nx-comments__empty">Aucun commentaire pour l'instant.</p>
      ) : (
        <ol className="nx-comments__list">
          {optimisticComments.map((c) => (
            <li key={c.id}>
              <CardCommentItem
                comment={c}
                csrfToken={csrfToken}
                onOptimisticUpdate={applyUpdate}
                onOptimisticDelete={applyDelete}
              />
            </li>
          ))}
        </ol>
      )}
      <CardCommentForm
        cardId={cardId}
        csrfToken={csrfToken}
        disabled={!canPost}
        onOptimisticAdd={applyAdd}
      />
    </section>
  );
}
