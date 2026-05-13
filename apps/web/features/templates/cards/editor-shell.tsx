'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CardTemplateInputType, CardTemplateItem } from '@nexushub/domain';
import { useEditorState, type TemplateDTO } from './use-editor-state';
import { TemplatesList } from './templates-list';
import { TemplateEditor } from './template-editor';
import { TemplatePreview } from './template-preview';
import { EditItemDrawer } from './edit-item-drawer';
import { createCardTemplate, updateCardTemplate, deleteCardTemplate } from './actions';

export interface EditorShellProps {
  readonly initialTemplates: readonly TemplateDTO[];
}

export function EditorShell({ initialTemplates }: EditorShellProps) {
  const router = useRouter();
  const { state, dispatch } = useEditorState(initialTemplates);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // beforeunload dirty guard (V1 scope)
  useEffect(() => {
    if (!state.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.isDirty]);

  const editingItem: CardTemplateItem | null = (() => {
    if (!state.editingItemId || !state.draft) return null;
    return state.draft.items.find((i) => i.id === state.editingItemId) ?? null;
  })();

  const onCreate = () => {
    setError(null);
    startTransition(async () => {
      const res = await createCardTemplate({
        name: 'Sans titre',
        body: '',
        items: [],
        defaultChecklist: [],
        isDefault: false,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({
        type: 'created',
        template: { id: res.id, name: 'Sans titre', items: [], isDefault: false },
      });
      router.refresh();
    });
  };

  const onSave = () => {
    if (!state.draft || !state.selectedId) return;
    setError(null);
    const selectedId = state.selectedId;
    const draft = state.draft;
    startTransition(async () => {
      const res = await updateCardTemplate({
        id: selectedId,
        name: draft.name,
        body: '',
        items: draft.items,
        defaultChecklist: [],
        isDefault: draft.isDefault,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({
        type: 'saved',
        template: {
          id: selectedId,
          name: draft.name,
          items: draft.items,
          isDefault: draft.isDefault,
        },
      });
      router.refresh();
    });
  };

  const onDeleteTemplate = () => {
    if (!state.selectedId) return;
    const name = state.draft?.name ?? '';
    if (!window.confirm(`Supprimer le template « ${name} » ?`)) return;
    setError(null);
    const id = state.selectedId;
    startTransition(async () => {
      const res = await deleteCardTemplate({ id });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({ type: 'deleted', id });
      router.refresh();
    });
  };

  const onDeleteFromList = (id: string, name: string) => {
    if (!window.confirm(`Supprimer le template « ${name} » ?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCardTemplate({ id });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({ type: 'deleted', id });
      router.refresh();
    });
  };

  return (
    <div className="grid h-[calc(100vh-180px)] grid-cols-[280px_minmax(360px,0.9fr)_minmax(360px,1.1fr)] gap-4">
      <div className="relative">
        <TemplatesList
          templates={state.templates}
          selectedId={state.selectedId}
          isDirty={state.isDirty}
          onSelect={(id) => dispatch({ type: 'selectTemplate', id })}
          onCreate={onCreate}
          onDelete={onDeleteFromList}
        />
        <EditItemDrawer
          item={editingItem}
          onClose={() => dispatch({ type: 'closeItemDrawer' })}
          onUpdate={(id, patch) => dispatch({ type: 'updateItem', id, patch })}
          onConvertType={(id, toType: CardTemplateInputType) =>
            dispatch({ type: 'convertItemType', id, toType })
          }
          onRemove={(id) => dispatch({ type: 'removeItem', id })}
        />
      </div>

      {state.draft && state.selectedId ? (
        <TemplateEditor
          name={state.draft.name}
          items={state.draft.items}
          isDefault={state.draft.isDefault}
          isDirty={state.isDirty}
          isSaving={pending}
          editingItemId={state.editingItemId}
          onRename={(name) => dispatch({ type: 'renameDraft', name })}
          onToggleDefault={(isDefault) => dispatch({ type: 'setDraftDefault', isDefault })}
          onAddItem={(type) => dispatch({ type: 'addItem', itemType: type })}
          onReorder={(from, to) => dispatch({ type: 'reorderItems', from, to })}
          onEditItem={(id) => dispatch({ type: 'openItemDrawer', id })}
          onRemoveItem={(id) => dispatch({ type: 'removeItem', id })}
          onSave={onSave}
          onCancel={() =>
            state.selectedId
              ? dispatch({ type: 'selectTemplate', id: state.selectedId })
              : undefined
          }
          onDeleteTemplate={onDeleteTemplate}
        />
      ) : (
        <EmptyEditor />
      )}

      {state.draft ? (
        <TemplatePreview templateName={state.draft.name} items={state.draft.items} />
      ) : (
        <div />
      )}

      {error ? (
        <div className="col-span-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function EmptyEditor() {
  return (
    <section className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 text-center text-sm text-[color:var(--color-text-muted)]">
      Sélectionne un template à gauche, ou crée-en un nouveau.
    </section>
  );
}
