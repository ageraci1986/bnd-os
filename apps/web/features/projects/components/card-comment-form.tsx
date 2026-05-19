'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createComment, type CreateCommentState } from '../actions/create-comment';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { CommentEditor, type CommentEditorHandle } from './comment-editor';

export interface CardCommentFormProps {
  readonly cardId: string;
  readonly csrfToken: string;
  /** When true (rare locked card / out-of-scope mode), the form is hidden.
   *  In-scope Viewers are NOT disabled — posting comments is their only
   *  mutation right per the spec. */
  readonly disabled?: boolean;
}

const INITIAL: CreateCommentState = { status: 'idle' };

export function CardCommentForm({ cardId, csrfToken, disabled }: CardCommentFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createComment, INITIAL);
  const editorRef = useRef<CommentEditorHandle | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (state.status === 'success') {
      editorRef.current?.clear();
      router.refresh();
    }
  }, [state, router]);

  if (disabled) return null;

  return (
    <form ref={formRef} action={formAction} className="nx-comment-form">
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <input type="hidden" name="cardId" value={cardId} />
      <CommentEditor
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
