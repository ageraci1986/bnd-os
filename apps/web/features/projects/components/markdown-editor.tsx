'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';

export interface MarkdownEditorHandle {
  clear: () => void;
  focus: () => void;
}

export interface MarkdownEditorProps {
  /**
   * When provided, renders a hidden `<input name={name}>` with the serialised
   * Markdown value — used by comment forms (form-mode).
   * When absent, no hidden input is rendered — used by the description
   * autosave (live-mode via `onChange`).
   */
  readonly name?: string;
  /** Markdown source to prefill (edit mode). */
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly ariaLabel: string;
  /** Cmd/Ctrl+Enter → parent form submit. */
  readonly onSubmitShortcut?: () => void;
  /**
   * Called on every document update with the serialised Markdown string.
   * Used by the description autosave flow (no hidden input needed).
   * A ref is used internally to avoid stale-closure issues.
   */
  readonly onChange?: (markdown: string) => void;
}

/** Read the editor document back as Markdown (tiptap-markdown storage API). */
function toMarkdown(editor: Editor | null): string {
  if (!editor) return '';
  // tiptap-markdown v0.9 exposes storage.markdown.getMarkdown() directly
  const storage = editor.storage as {
    markdown?: { getMarkdown?: () => string };
  };
  const md = storage.markdown?.getMarkdown?.();
  return typeof md === 'string' ? md.trim() : '';
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    { name, defaultValue, placeholder, disabled, ariaLabel, onSubmitShortcut, onChange },
    ref,
  ) {
    // Keep a React state copy of the Markdown so the hidden input is always
    // in sync without relying on a single render cycle (avoids one-keystroke lag).
    const [markdownValue, setMarkdownValue] = useState<string>(defaultValue ?? '');

    // Stable ref for onChange to avoid stale closures inside useEditor's onUpdate.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const editor = useEditor({
      immediatelyRender: false,
      editable: !disabled,
      extensions: [
        StarterKit.configure({
          heading: false,
          horizontalRule: false,
        }),
        Underline,
        Link.configure({
          openOnClick: false,
          autolink: true,
          protocols: ['https', 'mailto'],
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        }),
        Placeholder.configure({ placeholder: placeholder ?? '' }),
        Markdown.configure({ html: false, linkify: true }),
      ],
      content: defaultValue ?? '',
      onUpdate: ({ editor: e }) => {
        const md = toMarkdown(e);
        setMarkdownValue(md);
        onChangeRef.current?.(md);
      },
      editorProps: {
        attributes: {
          'aria-label': ariaLabel,
          class: 'nx-comment-editor__surface',
        },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            onSubmitShortcut?.();
            return true;
          }
          return false;
        },
      },
    });

    // Keep Tiptap's editable state in sync when `disabled` changes at runtime.
    // Tiptap's `<fieldset disabled>` does NOT disable a contenteditable, so we
    // must call setEditable() explicitly (critical for Viewer/read-only mode).
    useEffect(() => {
      editor?.setEditable(!disabled);
    }, [editor, disabled]);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          editor?.commands.clearContent(true);
          setMarkdownValue('');
        },
        focus: () => editor?.commands.focus(),
      }),
      [editor],
    );

    const isActive = (mark: string) => editor?.isActive(mark) ?? false;

    const setLink = () => {
      if (!editor) return;
      const previous = (editor.getAttributes('link')['href'] as string | undefined) ?? 'https://';
      const url = window.prompt('URL du lien (https://…)', previous);
      if (url === null) return;
      if (url.trim().length === 0) {
        editor.chain().focus().unsetLink().run();
        return;
      }
      editor.chain().focus().setLink({ href: url.trim() }).run();
    };

    return (
      <div className="nx-comment-editor">
        <div className="nx-comment-editor__toolbar" role="toolbar" aria-label="Mise en forme">
          <button
            type="button"
            className={
              isActive('bold') ? 'nx-comment-editor__btn is-active' : 'nx-comment-editor__btn'
            }
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={disabled}
            title="Gras (Cmd/Ctrl+B)"
            aria-label="Gras"
            aria-pressed={isActive('bold')}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={
              isActive('italic') ? 'nx-comment-editor__btn is-active' : 'nx-comment-editor__btn'
            }
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={disabled}
            title="Italique (Cmd/Ctrl+I)"
            aria-label="Italique"
            aria-pressed={isActive('italic')}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={
              isActive('underline') ? 'nx-comment-editor__btn is-active' : 'nx-comment-editor__btn'
            }
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            disabled={disabled}
            title="Souligné (Cmd/Ctrl+U)"
            aria-label="Souligné"
            aria-pressed={isActive('underline')}
          >
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <button
            type="button"
            className={
              isActive('link') ? 'nx-comment-editor__btn is-active' : 'nx-comment-editor__btn'
            }
            onClick={setLink}
            disabled={disabled}
            title="Lien"
            aria-label="Lien"
            aria-pressed={isActive('link')}
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
        <EditorContent editor={editor} />
        {name !== undefined ? <input type="hidden" name={name} value={markdownValue} /> : null}
      </div>
    );
  },
);
