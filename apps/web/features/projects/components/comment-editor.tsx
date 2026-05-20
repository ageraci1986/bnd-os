'use client';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';

export interface CommentEditorHandle {
  clear: () => void;
  focus: () => void;
}

export interface CommentEditorProps {
  readonly name: string;
  /** Markdown source to prefill (edit mode). */
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly ariaLabel: string;
  /** Cmd/Ctrl+Enter → parent form submit. */
  readonly onSubmitShortcut?: () => void;
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

export const CommentEditor = forwardRef<CommentEditorHandle, CommentEditorProps>(
  function CommentEditor(
    { name, defaultValue, placeholder, disabled, ariaLabel, onSubmitShortcut },
    ref,
  ) {
    // Keep a React state copy of the Markdown so the hidden input is always
    // in sync without relying on a single render cycle (avoids one-keystroke lag).
    const [markdownValue, setMarkdownValue] = useState<string>(defaultValue ?? '');

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
        setMarkdownValue(toMarkdown(e));
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
            className={`nx-comment-editor__btn${isActive('bold') ? 'is-active' : ''}`}
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
            className={`nx-comment-editor__btn${isActive('italic') ? 'is-active' : ''}`}
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
            className={`nx-comment-editor__btn${isActive('underline') ? 'is-active' : ''}`}
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
            className={`nx-comment-editor__btn${isActive('link') ? 'is-active' : ''}`}
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
        <input type="hidden" name={name} value={markdownValue} />
      </div>
    );
  },
);
