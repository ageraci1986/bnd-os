'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useEditorState, type KanbanTemplateDTO } from './use-editor-state';
import { TemplateToolbar } from './template-toolbar';
import { BoardView } from './board-view';
import { StepChecklistModal } from './step-checklist-modal';
import {
  createKanbanTemplate,
  deleteKanbanTemplate,
  duplicateKanbanTemplate,
  updateKanbanTemplate,
} from './actions';

export interface CardTemplateOption {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface KanbanEditorShellProps {
  readonly initialTemplates: readonly KanbanTemplateDTO[];
  /** Workspace card templates surfaced in the "card template" picker.
   *  Empty list = nothing to pick from, the picker is rendered disabled. */
  readonly cardTemplateOptions: readonly CardTemplateOption[];
}

/**
 * Top-level orchestrator for /templates/kanban — owns the template
 * list, the dirty draft, the step-checklist modal state, and routes
 * the server actions through useTransition for spinner ergonomics.
 */
export function KanbanEditorShell({
  initialTemplates,
  cardTemplateOptions,
}: KanbanEditorShellProps) {
  const router = useRouter();
  const { state, dispatch } = useEditorState(initialTemplates);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState<number | null>(null);

  // Block accidental navigation when there are unsaved edits (V1 scope:
  // covers tab close / reload, intra-app router pushes are user-driven).
  useEffect(() => {
    if (!state.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.isDirty]);

  const onCreate = () => {
    if (state.isDirty && !window.confirm('Modifications non sauvées. Créer un nouveau template ?'))
      return;
    setError(null);
    startTransition(async () => {
      const res = await createKanbanTemplate({
        name: 'Sans titre',
        columns: [{ name: 'À faire', stepChecklist: [] }],
        defaultCardTemplateId: null,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({
        type: 'created',
        template: {
          id: res.id,
          name: 'Sans titre',
          columns: [{ name: 'À faire', stepChecklist: [] }],
          defaultCardTemplateId: null,
        },
      });
      router.refresh();
    });
  };

  const onSave = () => {
    if (!state.draft || !state.selectedId) return;
    setError(null);
    const id = state.selectedId;
    const draft = state.draft;
    startTransition(async () => {
      const res = await updateKanbanTemplate({
        id,
        name: draft.name,
        columns: draft.columns,
        defaultCardTemplateId: draft.defaultCardTemplateId,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({
        type: 'saved',
        template: {
          id,
          name: draft.name,
          columns: draft.columns,
          defaultCardTemplateId: draft.defaultCardTemplateId,
        },
      });
      router.refresh();
    });
  };

  const onDuplicate = () => {
    if (!state.selectedId) return;
    if (state.isDirty && !window.confirm('Modifications non sauvées seront ignorées. Dupliquer ?'))
      return;
    setError(null);
    const sourceId = state.selectedId;
    startTransition(async () => {
      const res = await duplicateKanbanTemplate({ id: sourceId });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      // Refresh so the new template appears in the toolbar dropdown; the
      // server returns the new id, but the full data shape isn't sent
      // back. Server-driven refresh is the simplest correct path here.
      router.refresh();
    });
  };

  const onDelete = () => {
    if (!state.selectedId) return;
    const name = state.draft?.name ?? '';
    if (!window.confirm(`Supprimer le template « ${name} » ?`)) return;
    setError(null);
    const id = state.selectedId;
    startTransition(async () => {
      const res = await deleteKanbanTemplate({ id });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({ type: 'deleted', id });
      router.refresh();
    });
  };

  const stepItems =
    stepIdx !== null && state.draft ? (state.draft.columns[stepIdx]?.stepChecklist ?? []) : [];
  const stepColumnName =
    stepIdx !== null && state.draft ? (state.draft.columns[stepIdx]?.name ?? '') : '';

  return (
    <>
      <TemplateToolbar
        templates={state.templates}
        selectedId={state.selectedId}
        isDirty={state.isDirty}
        isSaving={pending}
        onSelect={(id) => dispatch({ type: 'selectTemplate', id })}
        onCreate={onCreate}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onSave={onSave}
      />

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[color:var(--color-warning)] bg-[color:var(--color-warning-bg)] px-5 py-4 text-sm text-[color:var(--color-text-soft)]">
        <span className="text-xl leading-none text-[color:var(--color-warning)]">⚠</span>
        <p>
          <strong>Modifier ce template n&apos;affecte pas les projets existants.</strong> Le
          template n&apos;est consommé qu&apos;au moment de la création d&apos;un nouveau projet.
          Les projets actifs gardent leur structure actuelle.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {state.draft && state.selectedId ? (
        <div key={state.selectedId} className="nx-fade-in">
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-5 py-3 shadow-[var(--shadow-card)]">
            <label
              htmlFor="kanban-template-name"
              className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]"
            >
              Nom
            </label>
            <input
              id="kanban-template-name"
              type="text"
              value={state.draft.name}
              maxLength={80}
              onChange={(e) => dispatch({ type: 'renameDraft', name: e.target.value })}
              placeholder="Nom du template"
              className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-bold tracking-[-0.3px] outline-none focus:border-[color:var(--color-border-light)]"
            />
            {state.isDirty ? (
              <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
                non sauvé
              </span>
            ) : null}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-5 py-3">
            <label
              htmlFor="kanban-template-card-template"
              className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]"
            >
              Template de carte
            </label>
            <select
              id="kanban-template-card-template"
              value={state.draft.defaultCardTemplateId ?? ''}
              onChange={(e) =>
                dispatch({
                  type: 'setDefaultCardTemplate',
                  id: e.target.value.length > 0 ? e.target.value : null,
                })
              }
              disabled={cardTemplateOptions.length === 0}
              className="field-select min-w-[220px] flex-1"
              aria-describedby="kanban-template-card-template-hint"
            >
              <option value="">— Défaut du workspace —</option>
              {cardTemplateOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isDefault ? ' (défaut workspace)' : ''}
                </option>
              ))}
            </select>
            <p
              id="kanban-template-card-template-hint"
              className="basis-full text-[11px] text-[color:var(--color-text-muted)]"
            >
              {cardTemplateOptions.length === 0
                ? "Aucun template de carte dans ce workspace. Crée-en un dans Templates > Cartes pour pouvoir l'associer ici."
                : 'Choix appliqué aux nouvelles cartes des projets créés à partir de ce template Kanban. Snapshot pris à la création du projet — éditer ce champ plus tard ne touchera pas les projets existants.'}
            </p>
          </div>

          <BoardView
            columns={state.draft.columns}
            onReorder={(from, to) => dispatch({ type: 'reorderColumns', from, to })}
            onRenameColumn={(idx, name) => dispatch({ type: 'renameColumn', idx, name })}
            onRemoveColumn={(idx) => dispatch({ type: 'removeColumn', idx })}
            onAddColumn={() => dispatch({ type: 'addColumn' })}
            onEditStepChecklist={(idx) => setStepIdx(idx)}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-12 text-center text-sm text-[color:var(--color-text-muted)]">
          Aucun template sélectionné — utilise « + Nouveau » dans la barre d&apos;outils.
        </div>
      )}

      <StepChecklistModal
        open={stepIdx !== null}
        columnName={stepColumnName}
        items={stepItems}
        onClose={() => setStepIdx(null)}
        onSave={(items) => {
          if (stepIdx !== null) dispatch({ type: 'setStepChecklist', idx: stepIdx, items });
          setStepIdx(null);
        }}
      />
    </>
  );
}
