'use client';
import { useMemo, useReducer } from 'react';
import type { KanbanTemplateColumnDef } from '@nexushub/domain';

export interface KanbanTemplateDTO {
  readonly id: string;
  readonly name: string;
  readonly columns: readonly KanbanTemplateColumnDef[];
  readonly isBuiltin?: boolean;
  readonly usageCount?: number;
}

export interface EditorDraft {
  readonly name: string;
  readonly columns: readonly KanbanTemplateColumnDef[];
}

export interface EditorState {
  readonly templates: readonly KanbanTemplateDTO[];
  readonly selectedId: string | null;
  readonly draft: EditorDraft | null;
  readonly isDirty: boolean;
}

export type Action =
  | { type: 'selectTemplate'; id: string }
  | { type: 'deselect' }
  | { type: 'renameDraft'; name: string }
  | { type: 'addColumn' }
  | { type: 'removeColumn'; idx: number }
  | { type: 'renameColumn'; idx: number; name: string }
  | { type: 'reorderColumns'; from: number; to: number }
  | { type: 'setStepChecklist'; idx: number; items: readonly string[] }
  | { type: 'saved'; template: KanbanTemplateDTO }
  | { type: 'created'; template: KanbanTemplateDTO }
  | { type: 'deleted'; id: string };

export function makeInitialState(templates: readonly KanbanTemplateDTO[]): EditorState {
  const first = templates[0] ?? null;
  if (!first) {
    return { templates, selectedId: null, draft: null, isDirty: false };
  }
  return {
    templates,
    selectedId: first.id,
    draft: { name: first.name, columns: first.columns },
    isDirty: false,
  };
}

export function reduceEditorState(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'selectTemplate': {
      const tpl = state.templates.find((t) => t.id === action.id);
      if (!tpl) return state;
      return {
        ...state,
        selectedId: tpl.id,
        draft: { name: tpl.name, columns: tpl.columns },
        isDirty: false,
      };
    }
    case 'deselect':
      return { ...state, selectedId: null, draft: null, isDirty: false };
    case 'renameDraft':
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, name: action.name }, isDirty: true };
    case 'addColumn': {
      if (!state.draft) return state;
      const next: KanbanTemplateColumnDef[] = [
        ...state.draft.columns,
        { name: 'Nouvelle colonne', stepChecklist: [] },
      ];
      return { ...state, draft: { ...state.draft, columns: next }, isDirty: true };
    }
    case 'removeColumn': {
      if (!state.draft) return state;
      const next = state.draft.columns.filter((_, i) => i !== action.idx);
      return { ...state, draft: { ...state.draft, columns: next }, isDirty: true };
    }
    case 'renameColumn': {
      if (!state.draft) return state;
      const next = state.draft.columns.map((c, i) =>
        i === action.idx ? { ...c, name: action.name } : c,
      );
      return { ...state, draft: { ...state.draft, columns: next }, isDirty: true };
    }
    case 'reorderColumns': {
      if (!state.draft) return state;
      const { from, to } = action;
      if (from === to) return state;
      const cols = [...state.draft.columns];
      const [moved] = cols.splice(from, 1);
      if (!moved) return state;
      cols.splice(to, 0, moved);
      return { ...state, draft: { ...state.draft, columns: cols }, isDirty: true };
    }
    case 'setStepChecklist': {
      if (!state.draft) return state;
      const next = state.draft.columns.map((c, i) =>
        i === action.idx ? { ...c, stepChecklist: action.items } : c,
      );
      return { ...state, draft: { ...state.draft, columns: next }, isDirty: true };
    }
    case 'saved': {
      return {
        ...state,
        templates: state.templates.map((t) => (t.id === action.template.id ? action.template : t)),
        isDirty: false,
      };
    }
    case 'created': {
      return {
        ...state,
        templates: [...state.templates, action.template],
        selectedId: action.template.id,
        draft: { name: action.template.name, columns: action.template.columns },
        isDirty: false,
      };
    }
    case 'deleted':
      return {
        ...state,
        templates: state.templates.filter((t) => t.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        draft: state.selectedId === action.id ? null : state.draft,
        isDirty: state.selectedId === action.id ? false : state.isDirty,
      };
  }
}

export function useEditorState(initial: readonly KanbanTemplateDTO[]) {
  const [state, dispatch] = useReducer(reduceEditorState, undefined, () =>
    makeInitialState(initial),
  );
  const selectedTemplate = useMemo(
    () =>
      state.selectedId ? (state.templates.find((t) => t.id === state.selectedId) ?? null) : null,
    [state.selectedId, state.templates],
  );
  return { state, dispatch, selectedTemplate };
}
