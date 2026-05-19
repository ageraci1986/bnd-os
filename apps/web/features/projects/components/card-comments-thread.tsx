'use client';
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

export function CardCommentsThread({
  cardId,
  csrfToken,
  comments,
  canPost = true,
}: CardCommentsThreadProps) {
  return (
    <section className="nx-comments" aria-labelledby="nx-comments-title">
      <h3 id="nx-comments-title" className="nx-comments__title">
        Commentaires ({comments.length})
      </h3>
      {comments.length === 0 ? (
        <p className="nx-comments__empty">Aucun commentaire pour l'instant.</p>
      ) : (
        <ol className="nx-comments__list">
          {comments.map((c) => (
            <li key={c.id}>
              <CardCommentItem comment={c} csrfToken={csrfToken} />
            </li>
          ))}
        </ol>
      )}
      <CardCommentForm cardId={cardId} csrfToken={csrfToken} disabled={!canPost} />
    </section>
  );
}
