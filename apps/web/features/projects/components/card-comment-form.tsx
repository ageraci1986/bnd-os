'use client';
import { useActionState, useEffect, useRef } from 'react';
import { createComment, type CreateCommentState } from '../actions/create-comment';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { MarkdownEditor, type MarkdownEditorHandle } from './markdown-editor';
import type { CardCommentDTO } from '../lib/comment-dto';

export interface CardCommentFormProps {
  readonly cardId: string;
  readonly csrfToken: string;
  /** When true (rare locked card / out-of-scope mode), the form is hidden.
   *  In-scope Viewers are NOT disabled — posting comments is their only
   *  mutation right per the spec. */
  readonly disabled?: boolean;
  /**
   * Called immediately after a successful server round-trip so the thread
   * can append the new comment optimistically (React 19 useOptimistic).
   * The comment id comes from the server; the body/html are provisional
   * (plain text until the next navigation brings server-rendered HTML).
   */
  readonly onOptimisticAdd?: (comment: CardCommentDTO) => void;
}

const INITIAL: CreateCommentState = { status: 'idle' };

/** Escape plain text for safe injection into dangerouslySetInnerHTML. */
function escapePlainText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

export function CardCommentForm({
  cardId,
  csrfToken,
  disabled,
  onOptimisticAdd,
}: CardCommentFormProps) {
  const [state, formAction, pending] = useActionState(createComment, INITIAL);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  // Keep a ref to the last submitted body so we can build the optimistic DTO.
  const pendingBodyRef = useRef<string>('');

  useEffect(() => {
    if (state.status === 'success') {
      editorRef.current?.clear();
      if (onOptimisticAdd) {
        const now = new Date().toISOString();
        const optimistic: CardCommentDTO = {
          id: state.commentId,
          body: pendingBodyRef.current,
          // Server-rendered markdown arrives on the next navigation; use
          // plain-text HTML as a provisional stand-in.
          bodyHtml: `<p>${escapePlainText(pendingBodyRef.current)}</p>`,
          createdAt: now,
          updatedAt: now,
          isEdited: false,
          author: {
            id: '__optimistic__',
            displayName: 'Vous',
            initials: '…',
          },
          isMine: true,
          canModerate: false,
        };
        onOptimisticAdd(optimistic);
      }
      pendingBodyRef.current = '';
    }
  }, [state, onOptimisticAdd]);

  if (disabled) return null;

  return (
    <form
      ref={formRef}
      action={formAction}
      className="nx-comment-form"
      onSubmit={() => {
        // Capture the body text before the action fires so we have it in the
        // success effect.
        const bodyEl = formRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>(
          '[name="body"]',
        );
        if (bodyEl) pendingBodyRef.current = bodyEl.value;
      }}
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <input type="hidden" name="cardId" value={cardId} />
      <MarkdownEditor
        ref={editorRef}
        name="body"
        placeholder="Écris un commentaire… (Cmd/Ctrl+Enter pour envoyer)"
        ariaLabel="Nouveau commentaire"
        disabled={pending}
        onSubmitShortcut={() => formRef.current?.requestSubmit()}
      />
      <div className="nx-comment-form__footer">
        {state.status === 'error' ? (
          <p className="nx-comment-form__error" role="alert">
            {state.message}
          </p>
        ) : (
          <span className="nx-comment-form__hint">Cmd/Ctrl+B · I · U · K pour formater</span>
        )}
        <button type="submit" className="nx-btn nx-btn--primary" disabled={pending}>
          {pending ? 'Envoi…' : 'Envoyer'}
        </button>
      </div>
    </form>
  );
}
