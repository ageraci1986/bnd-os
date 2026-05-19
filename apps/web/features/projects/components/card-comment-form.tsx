'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createComment, type CreateCommentState } from '../actions/create-comment';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';

export interface CardCommentFormProps {
  readonly cardId: string;
  readonly csrfToken: string;
  /** When true (Viewer out-of-scope, or rare locked card), the form is hidden. */
  readonly disabled?: boolean;
}

const INITIAL: CreateCommentState = { status: 'idle' };

export function CardCommentForm({ cardId, csrfToken, disabled }: CardCommentFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createComment, INITIAL);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (state.status === 'success' && textareaRef.current) {
      textareaRef.current.value = '';
      router.refresh();
    }
  }, [state, router]);

  if (disabled) return null;

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  return (
    <form ref={formRef} action={formAction} className="nx-comment-form">
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <input type="hidden" name="cardId" value={cardId} />
      <textarea
        ref={textareaRef}
        name="body"
        placeholder="Écris un commentaire… (markdown supporté · Cmd/Ctrl+Enter pour envoyer)"
        rows={3}
        maxLength={10_000}
        onKeyDown={handleKey}
        aria-label="Nouveau commentaire"
        className="nx-comment-form__textarea"
        disabled={pending}
      />
      <div className="nx-comment-form__footer">
        {state.status === 'error' ? (
          <p className="nx-comment-form__error" role="alert">
            {state.message}
          </p>
        ) : (
          <span className="nx-comment-form__hint">
            Markdown : **gras** · *italique* · `code` · [lien](https://…)
          </span>
        )}
        <button type="submit" className="nx-btn nx-btn--primary" disabled={pending}>
          {pending ? 'Envoi…' : 'Envoyer'}
        </button>
      </div>
    </form>
  );
}
