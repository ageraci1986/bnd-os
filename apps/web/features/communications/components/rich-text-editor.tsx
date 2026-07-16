'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { useEffect } from 'react';

interface Props {
  readonly value: string;
  readonly onChange: (html: string) => void;
  readonly minHeight?: number;
}

/**
 * Tiptap wrapper with a minimal 6-button toolbar (bold, italic, underline,
 * link, bullet list, ordered list). Shared by the mail compose panel
 * (Task 19) and the signature editor in Settings (Task 23).
 */
export function RichTextEditor({ value, onChange, minHeight = 200 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none px-3 py-2',
        style: `min-height: ${minHeight}px`,
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
    // Mandatory under Next.js App Router with Tiptap 3.x: the SSR-safe
    // default flipped in v3, so this must be explicit or hydration breaks.
    immediatelyRender: false,
  });

  // Keep the editor in sync when the external `value` changes (draft load,
  // From switch replacing the signature) without clobbering user input.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === value) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="rounded-md border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)]">
      <div className="flex items-center gap-1 border-b border-[color:var(--color-border-light)] px-2 py-1 text-sm">
        <ToolbarButton
          on={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </ToolbarButton>
        <ToolbarButton
          on={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          on={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <u>U</u>
        </ToolbarButton>
        <ToolbarButton
          on={editor.isActive('link')}
          onClick={() => {
            const url = window.prompt('Lien (https://…)');
            if (!url) return;
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
          }}
        >
          🔗
        </ToolbarButton>
        <ToolbarButton
          on={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •
        </ToolbarButton>
        <ToolbarButton
          on={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  on,
  onClick,
  children,
}: {
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs font-bold ${
        on
          ? 'bg-[color:var(--color-accent-primary)] text-white'
          : 'text-[color:var(--color-text-main)]'
      }`}
    >
      {children}
    </button>
  );
}
