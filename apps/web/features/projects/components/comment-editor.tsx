'use client';
import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface CommentEditorHandle {
  /** Imperative reset — called by the form after a successful submit. */
  clear: () => void;
  /** Imperative focus — used when the edit form opens. */
  focus: () => void;
}

export interface CommentEditorProps {
  readonly name: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly rows?: number;
  readonly maxLength?: number;
  readonly ariaLabel: string;
  /** Triggered on Cmd/Ctrl+Enter — the parent form submits. */
  readonly onSubmitShortcut?: () => void;
}

type WrapKind = 'bold' | 'italic' | 'underline' | 'link';

/**
 * Wraps the current selection in the textarea with the requested
 * markdown (or inline HTML for underline) markers. If nothing is
 * selected, a sensible placeholder is inserted and re-selected.
 */
function applyWrap(textarea: HTMLTextAreaElement, kind: WrapKind): void {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end);
  let before = '';
  let after = '';
  let placeholder = '';

  switch (kind) {
    case 'bold':
      before = '**';
      after = '**';
      placeholder = 'texte';
      break;
    case 'italic':
      before = '*';
      after = '*';
      placeholder = 'texte';
      break;
    case 'underline':
      before = '<u>';
      after = '</u>';
      placeholder = 'texte';
      break;
    case 'link': {
       
      const url = window.prompt('URL du lien (https://…)', 'https://');
      if (!url || url.trim().length === 0) return;
      const label = selected.length > 0 ? selected : 'libellé';
      const next = `${value.slice(0, start)}[${label}](${url.trim()})${value.slice(end)}`;
      textarea.value = next;
      // Re-select the label so the user can type to replace it.
      const newStart = start + 1; // skip the `[`
      const newEnd = newStart + label.length;
      textarea.setSelectionRange(newStart, newEnd);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
      return;
    }
  }

  const inner = selected.length > 0 ? selected : placeholder;
  const next = `${value.slice(0, start)}${before}${inner}${after}${value.slice(end)}`;
  textarea.value = next;
  const newStart = start + before.length;
  const newEnd = newStart + inner.length;
  textarea.setSelectionRange(newStart, newEnd);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

/**
 * Reusable comment editor: toolbar + textarea. Wraps current selection
 * with markdown (or `<u>` for underline). Markdown stays the storage
 * format — these buttons are just keystroke shortcuts.
 */
export const CommentEditor = forwardRef<CommentEditorHandle, CommentEditorProps>(
  function CommentEditor(
    {
      name,
      defaultValue,
      placeholder,
      disabled,
      rows = 3,
      maxLength = 10_000,
      ariaLabel,
      onSubmitShortcut,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          if (textareaRef.current) textareaRef.current.value = '';
        },
        focus: () => textareaRef.current?.focus(),
      }),
      [],
    );

    const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        onSubmitShortcut?.();
        return;
      }
      // Optional keyboard shortcuts mirror common editors.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        if (textareaRef.current) {
          e.preventDefault();
          applyWrap(textareaRef.current, 'bold');
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) {
        if (textareaRef.current) {
          e.preventDefault();
          applyWrap(textareaRef.current, 'italic');
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'u' || e.key === 'U')) {
        if (textareaRef.current) {
          e.preventDefault();
          applyWrap(textareaRef.current, 'underline');
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        if (textareaRef.current) {
          e.preventDefault();
          applyWrap(textareaRef.current, 'link');
        }
      }
    };

    const wrap = (kind: WrapKind) => {
      if (textareaRef.current) applyWrap(textareaRef.current, kind);
    };

    return (
      <div className="nx-comment-editor">
        <div className="nx-comment-editor__toolbar" role="toolbar" aria-label="Mise en forme">
          <button
            type="button"
            className="nx-comment-editor__btn"
            onClick={() => wrap('bold')}
            disabled={disabled}
            title="Gras (Cmd/Ctrl+B)"
            aria-label="Gras"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className="nx-comment-editor__btn"
            onClick={() => wrap('italic')}
            disabled={disabled}
            title="Italique (Cmd/Ctrl+I)"
            aria-label="Italique"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className="nx-comment-editor__btn"
            onClick={() => wrap('underline')}
            disabled={disabled}
            title="Souligné (Cmd/Ctrl+U)"
            aria-label="Souligné"
          >
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <button
            type="button"
            className="nx-comment-editor__btn"
            onClick={() => wrap('link')}
            disabled={disabled}
            title="Lien (Cmd/Ctrl+K)"
            aria-label="Lien"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6.5 9.5l3-3" />
              <path d="M7 4.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L10.5 8" />
              <path d="M9 11.5L7.5 13a2.5 2.5 0 0 1-3.5-3.5L5.5 8" />
            </svg>
          </button>
        </div>
        <textarea
          ref={textareaRef}
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          onKeyDown={handleKey}
          aria-label={ariaLabel}
          className="nx-comment-editor__textarea"
          disabled={disabled}
        />
      </div>
    );
  },
);
