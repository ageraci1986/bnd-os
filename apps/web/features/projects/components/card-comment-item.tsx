'use client';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { updateComment, type UpdateCommentState } from '../actions/update-comment';
import { deleteComment } from '../actions/delete-comment';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import type { CardCommentDTO } from '../lib/comment-dto';
import { MarkdownEditor, type MarkdownEditorHandle } from './markdown-editor';

const UPDATE_INITIAL: UpdateCommentState = { status: 'idle' };

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Escape plain text for provisional bodyHtml while waiting for server HTML. */
function escapePlainText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

export interface CardCommentItemProps {
  readonly comment: CardCommentDTO;
  readonly csrfToken: string;
  /** Called optimistically when the user saves an edit. */
  readonly onOptimisticUpdate?: (id: string, body: string, bodyHtml: string) => void;
  /** Called optimistically when the user confirms deletion. */
  readonly onOptimisticDelete?: (id: string) => void;
}

export function CardCommentItem({
  comment,
  csrfToken,
  onOptimisticUpdate,
  onOptimisticDelete,
}: CardCommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateComment, UPDATE_INITIAL);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const editFormRef = useRef<HTMLFormElement | null>(null);
  // Capture the body being submitted so the optimistic update can use it.
  const pendingUpdateBodyRef = useRef<string>('');

  useEffect(() => {
    if (updateState.status === 'success') {
      setIsEditing(false);
      if (onOptimisticUpdate) {
        const body = pendingUpdateBodyRef.current;
        onOptimisticUpdate(comment.id, body, `<p>${escapePlainText(body)}</p>`);
      }
      pendingUpdateBodyRef.current = '';
    }
  }, [updateState, comment.id, onOptimisticUpdate]);

  const canEdit = comment.isMine;
  const canDelete = comment.isMine || comment.canModerate;

  const handleDelete = () => {
    if (!window.confirm('Supprimer ce commentaire ?')) return;
    setDeleteError(null);
    startDelete(async () => {
      // Apply optimistically before the server round-trip.
      onOptimisticDelete?.(comment.id);
      const formData = new FormData();
      formData.set(CSRF_FIELD_NAME, csrfToken);
      formData.set('commentId', comment.id);
      const res = await deleteComment({ status: 'idle' }, formData);
      if (res.status === 'error') {
        // On error the optimistic dispatch has already fired — the parent's
        // useOptimistic will revert automatically when the transition ends
        // without a matching server update. Show the error locally.
        setDeleteError(res.message);
      }
    });
  };

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
          <form
            ref={editFormRef}
            action={updateAction}
            className="nx-comment__edit-form"
            onSubmit={() => {
              const bodyEl = editFormRef.current?.querySelector<
                HTMLTextAreaElement | HTMLInputElement
              >('[name="body"]');
              if (bodyEl) pendingUpdateBodyRef.current = bodyEl.value;
            }}
          >
            <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
            <input type="hidden" name="commentId" value={comment.id} />
            <MarkdownEditor
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
              <button
                type="button"
                onClick={handleDelete}
                disabled={deletePending}
                className="nx-btn nx-btn--link nx-btn--danger"
              >
                {deletePending ? 'Suppression…' : 'Supprimer'}
              </button>
            ) : null}
          </div>
        ) : null}
        {deleteError ? (
          <p role="alert" className="nx-comment__error">
            {deleteError}
          </p>
        ) : null}
      </div>
    </article>
  );
}
