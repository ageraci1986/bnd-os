'use client';
import { useReducer, useMemo } from 'react';
import {
  DESCRIPTION_ITEM_ID,
  defaultLabelForItemType,
  generateCustomFieldId,
  type CardTemplateItem,
  type CardTemplateInputType,
} from '@nexushub/domain';

export interface TemplateDTO {
  readonly id: string;
  readonly name: string;
  readonly items: readonly CardTemplateItem[];
  readonly isDefault?: boolean;
}

export interface EditorDraft {
  readonly name: string;
  readonly items: readonly CardTemplateItem[];
  readonly isDefault: boolean;
}

export interface EditorState {
  readonly templates: readonly TemplateDTO[];
  readonly selectedId: string | null;
  readonly draft: EditorDraft | null;
  readonly editingItemId: string | null;
  readonly isDirty: boolean;
}

export type Action =
  | { type: 'selectTemplate'; id: string }
  | { type: 'deselect' }
  | { type: 'renameDraft'; name: string }
  | { type: 'setDraftDefault'; isDefault: boolean }
  | { type: 'addItem'; itemType: CardTemplateItem['type'] }
  | { type: 'removeItem'; id: string }
  | { type: 'reorderItems'; from: number; to: number }
  | { type: 'updateItem'; id: string; patch: Record<string, unknown> }
  | { type: 'convertItemType'; id: string; toType: CardTemplateInputType }
  | { type: 'openItemDrawer'; id: string }
  | { type: 'closeItemDrawer' }
  | { type: 'saved'; template: TemplateDTO }
  | { type: 'created'; template: TemplateDTO }
  | { type: 'deleted'; id: string };

export function makeInitialState(templates: readonly TemplateDTO[]): EditorState {
  // Auto-select the workspace default template on first paint so the
  // editor isn't blank when arriving on /templates/cards. If no default
  // is set, fall back to the first template — there's always something
  // to look at as long as the workspace has any template.
  const auto = templates.find((t) => t.isDefault) ?? templates[0] ?? null;
  if (!auto) {
    return { templates, selectedId: null, draft: null, editingItemId: null, isDirty: false };
  }
  return {
    templates,
    selectedId: auto.id,
    draft: { name: auto.name, items: auto.items, isDefault: auto.isDefault ?? false },
    editingItemId: null,
    isDirty: false,
  };
}

function findItemIndex(items: readonly CardTemplateItem[], id: string): number {
  return items.findIndex((i) => i.id === id);
}

function takenIds(items: readonly CardTemplateItem[]): Set<string> {
  return new Set(items.map((i) => i.id));
}

export function reduceEditorState(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'selectTemplate': {
      const tpl = state.templates.find((t) => t.id === action.id);
      if (!tpl) return state;
      return {
        ...state,
        selectedId: tpl.id,
        draft: { name: tpl.name, items: tpl.items, isDefault: tpl.isDefault ?? false },
        editingItemId: null,
        isDirty: false,
      };
    }
    case 'deselect':
      return { ...state, selectedId: null, draft: null, editingItemId: null, isDirty: false };
    case 'renameDraft':
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, name: action.name }, isDirty: true };
    case 'setDraftDefault':
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, isDefault: action.isDefault }, isDirty: true };
    case 'addItem': {
      if (!state.draft) return state;
      if (action.itemType === 'description') {
        if (state.draft.items.some((i) => i.type === 'description')) return state;
        const newItem: CardTemplateItem = { id: DESCRIPTION_ITEM_ID, type: 'description' };
        return {
          ...state,
          draft: { ...state.draft, items: [...state.draft.items, newItem] },
          editingItemId: newItem.id,
          isDirty: true,
        };
      }
      const label = defaultLabelForItemType(action.itemType);
      const id = generateCustomFieldId(label, takenIds(state.draft.items));
      let newItem: CardTemplateItem;
      if (action.itemType === 'section') {
        newItem = { id, type: 'section', label };
      } else if (action.itemType === 'select') {
        newItem = { id, type: 'select', label, options: [] };
      } else {
        newItem = { id, type: action.itemType, label };
      }
      return {
        ...state,
        draft: { ...state.draft, items: [...state.draft.items, newItem] },
        editingItemId: newItem.id,
        isDirty: true,
      };
    }
    case 'removeItem': {
      if (!state.draft) return state;
      const idx = findItemIndex(state.draft.items, action.id);
      if (idx === -1) return state;
      const next = [...state.draft.items.slice(0, idx), ...state.draft.items.slice(idx + 1)];
      return {
        ...state,
        draft: { ...state.draft, items: next },
        editingItemId: state.editingItemId === action.id ? null : state.editingItemId,
        isDirty: true,
      };
    }
    case 'reorderItems': {
      if (!state.draft) return state;
      const { from, to } = action;
      if (from === to) return state;
      const items = [...state.draft.items];
      const [moved] = items.splice(from, 1);
      if (!moved) return state;
      items.splice(to, 0, moved);
      return { ...state, draft: { ...state.draft, items }, isDirty: true };
    }
    case 'updateItem': {
      if (!state.draft) return state;
      const next = state.draft.items.map((it) => {
        if (it.id !== action.id) return it;
        if (it.type === 'description') return it;
        return { ...it, ...action.patch } as CardTemplateItem;
      });
      return { ...state, draft: { ...state.draft, items: next }, isDirty: true };
    }
    case 'convertItemType': {
      if (!state.draft) return state;
      const next = state.draft.items.map((it) => {
        if (it.id !== action.id) return it;
        if (it.type === 'description' || it.type === 'section') return it;
        const toType = action.toType;
        const base = { id: it.id, label: it.label };
        const placeholder = 'placeholder' in it ? it.placeholder : undefined;
        if (toType === 'select') {
          return {
            ...base,
            type: 'select',
            options: [],
            ...(placeholder !== undefined ? { placeholder } : {}),
          } as CardTemplateItem;
        }
        return {
          ...base,
          type: toType,
          ...(placeholder !== undefined ? { placeholder } : {}),
        } as CardTemplateItem;
      });
      return { ...state, draft: { ...state.draft, items: next }, isDirty: true };
    }
    case 'openItemDrawer':
      return { ...state, editingItemId: action.id };
    case 'closeItemDrawer':
      return { ...state, editingItemId: null };
    case 'saved': {
      // Same default-flip rule as 'created' — see comment there.
      const newIsDefault = action.template.isDefault ?? false;
      const next = state.templates.map((t) => {
        if (t.id === action.template.id) return action.template;
        if (newIsDefault && t.isDefault) return { ...t, isDefault: false };
        return t;
      });
      return { ...state, templates: next, isDirty: false };
    }
    case 'created': {
      // Promoting a template to default flips every other one to false
      // (DB unique index allows at most one default per workspace).
      const newIsDefault = action.template.isDefault ?? false;
      const next = newIsDefault
        ? state.templates.map((t) => (t.isDefault ? { ...t, isDefault: false } : t))
        : state.templates;
      return {
        ...state,
        templates: [...next, action.template],
        selectedId: action.template.id,
        draft: {
          name: action.template.name,
          items: action.template.items,
          isDefault: newIsDefault,
        },
        editingItemId: null,
        isDirty: false,
      };
    }
    case 'deleted':
      return {
        ...state,
        templates: state.templates.filter((t) => t.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        draft: state.selectedId === action.id ? null : state.draft,
        editingItemId: state.selectedId === action.id ? null : state.editingItemId,
        isDirty: state.selectedId === action.id ? false : state.isDirty,
      };
  }
}

export function useEditorState(initial: readonly TemplateDTO[]) {
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
