'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateComment, type UpdateCommentState } from '../actions/update-comment';
import { deleteComment, type DeleteCommentState } from '../actions/delete-comment';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import type { CardCommentDTO } from '../lib/comment-dto';
import { CommentEditor, type CommentEditorHandle } from './comment-editor';

const UPDATE_INITIAL: UpdateCommentState = { status: 'idle' };
const DELETE_INITIAL: DeleteCommentState = { status: 'idle' };

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export interface CardCommentItemProps {
  readonly comment: CardCommentDTO;
  readonly csrfToken: string;
}

export function CardCommentItem({ comment, csrfToken }: CardCommentItemProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateComment, UPDATE_INITIAL);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteComment, DELETE_INITIAL);
  const editorRef = useRef<CommentEditorHandle | null>(null);
  const editFormRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (updateState.status === 'success') {
      setIsEditing(false);
      router.refresh();
    }
  }, [updateState, router]);

  useEffect(() => {
    if (deleteState.status === 'success') {
      router.refresh();
    }
  }, [deleteState, router]);

  const canEdit = comment.isMine;
  const canDelete = comment.isMine || comment.canModerate;

  return (
    <article className="nx-comment" aria-label={`Commentaire de ${comment.author.displayName}`}>
      <div className="nx-comment__avatar" aria-hidden="true">
        {comment.author.initials}
      </div>
      <div className="nx-comment__body">
        <header className="nx-comment__header">
          <strong className="nx-comment__author">{comment.author.displayName}</strong>
          <time className="nx-comment__date" dateTime={comment.createdAt}>
            {dateFmt.format(new Date(comment.createdAt))}
          </time>
          {comment.isEdited ? <span className="nx-comment__edited">(modifié)</span> : null}
        </header>

        {isEditing ? (
          <form ref={editFormRef} action={updateAction} className="nx-comment__edit-form">
            <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
            <input type="hidden" name="commentId" value={comment.id} />
            <CommentEditor
              ref={editorRef}
              name="body"
              defaultValue={comment.body}
              ariaLabel="Modifier le commentaire"
              disabled={updatePending}
              onSubmitShortcut={() => editFormRef.current?.requestSubmit()}
            />
            <div className="nx-comment__edit-actions">
              {updateState.status === 'error' ? (
                <p role="alert" className="nx-comment__error">
                  {updateState.message}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="nx-btn nx-btn--ghost"
              >
                Annuler
              </button>
              <button type="submit" disabled={updatePending} className="nx-btn nx-btn--primary">
                {updatePending ? 'Enregistre…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        ) : (
          <div
            className="nx-comment__content"
            // bodyHtml is server-rendered via @nexushub/integrations/markdown
            // (marked → DOMPurify whitelist). Safe to inject.
            dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
          />
        )}

        {(canEdit || canDelete) && !isEditing ? (
          <div className="nx-comment__actions">
            {canEdit ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="nx-btn nx-btn--link"
              >
                Modifier
              </button>
            ) : null}
            {canDelete ? (
              <form action={deleteAction} className="nx-comment__delete-form">
                <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
                <input type="hidden" name="commentId" value={comment.id} />
                <button
                  type="submit"
                  disabled={deletePending}
                  className="nx-btn nx-btn--link nx-btn--danger"
                  onClick={(e) => {
                    if (!window.confirm('Supprimer ce commentaire ?')) {
                      e.preventDefault();
                    }
                  }}
                >
                  {deletePending ? 'Suppression…' : 'Supprimer'}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {deleteState.status === 'error' ? (
          <p role="alert" className="nx-comment__error">
            {deleteState.message}
          </p>
        ) : null}
      </div>
    </article>
  );
}
