'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  CARD_FIELD_GROUPS,
  CARD_FIELD_PRESETS,
  CARD_FIELD_TYPES,
  DESCRIPTION_POSITIONS,
  generateCustomFieldId,
  type CardFieldDef,
  type CardFieldGroup,
  type CardFieldType,
  type CardTemplateDescriptionPosition,
} from '@nexushub/domain';
import { createCardTemplate, deleteCardTemplate, updateCardTemplate } from './actions';

export interface CardTemplateOption {
  readonly id: string;
  readonly name: string;
  readonly body: string;
  readonly fields: readonly CardFieldDef[];
  readonly defaultChecklist: readonly string[];
  readonly descriptionPosition: CardTemplateDescriptionPosition;
  readonly isDefault: boolean;
}

export interface CardTemplateEditorProps {
  readonly templates: readonly CardTemplateOption[];
}

export function CardTemplateEditor({ templates }: CardTemplateEditorProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const deleteFromList = (id: string, name: string) => {
    if (!window.confirm(`Supprimer le template « ${name} » ?`)) return;
    startTransition(async () => {
      const res = await deleteCardTemplate({ id });
      if (!res.ok) {
        window.alert(res.message);
        return;
      }
      if (selectedId === id) setSelectedId(null);
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      <aside>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
            Templates ({templates.length})
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
          >
            + Nouveau
          </button>
        </div>
        {templates.length === 0 && !creating ? (
          <p className="rounded-xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-4 text-xs text-[color:var(--color-text-muted)]">
            Aucun template. Créez-en un pour pré-configurer les champs de vos cartes.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {templates.map((t) => (
              <li key={t.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(t.id);
                    setCreating(false);
                  }}
                  className={[
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 pr-9 text-left text-sm transition',
                    t.id === selectedId
                      ? 'border-[color:var(--color-accent-primary)] bg-[image:var(--accent-gradient-soft)] font-bold'
                      : 'border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] font-medium hover:border-[color:var(--color-accent-primary)]',
                  ].join(' ')}
                >
                  <span className="truncate">{t.name}</span>
                  {t.isDefault ? (
                    <span className="rounded-full bg-[color:var(--color-accent-primary)] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.5px] text-white">
                      Défaut
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => deleteFromList(t.id, t.name)}
                  disabled={pending}
                  aria-label={`Supprimer ${t.name}`}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-xs text-[color:var(--color-text-muted)] opacity-0 transition hover:bg-[color:var(--color-danger-bg)] hover:text-[color:var(--color-danger)] group-hover:opacity-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main>
        {creating ? (
          <TemplateForm
            key="new"
            mode="create"
            initial={{
              name: '',
              body: '',
              fields: [],
              defaultChecklist: [],
              descriptionPosition: 'after-fields',
              isDefault: templates.length === 0,
            }}
            onSaved={(id) => {
              setCreating(false);
              setSelectedId(id);
              router.refresh();
            }}
            onCancel={() => setCreating(false)}
          />
        ) : selected ? (
          <TemplateForm
            key={selected.id}
            mode="edit"
            initial={selected}
            onSaved={() => router.refresh()}
            onDeleted={() => {
              setSelectedId(null);
              router.refresh();
            }}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-10 text-center">
            <h2 className="text-xl font-extrabold tracking-tight">Aucun template sélectionné</h2>
            <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
              Choisissez un template à gauche, ou créez-en un nouveau.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

interface TemplateFormProps {
  mode: 'create' | 'edit';
  initial: {
    id?: string;
    name: string;
    body: string;
    fields: readonly CardFieldDef[];
    defaultChecklist: readonly string[];
    descriptionPosition: CardTemplateDescriptionPosition;
    isDefault: boolean;
  };
  onSaved: (id: string) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
}

function TemplateForm({ mode, initial, onSaved, onDeleted, onCancel }: TemplateFormProps) {
  const [name, setName] = useState(initial.name);
  const [body, setBody] = useState(initial.body);
  const [fields, setFields] = useState<CardFieldDef[]>([...initial.fields]);
  const [checklist, setChecklist] = useState<string[]>([...initial.defaultChecklist]);
  const [descriptionPosition, setDescriptionPosition] = useState<CardTemplateDescriptionPosition>(
    initial.descriptionPosition,
  );
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const initialId = initial.id;
  useEffect(() => {
    setName(initial.name);
    setBody(initial.body);
    setFields([...initial.fields]);
    setChecklist([...initial.defaultChecklist]);
    setDescriptionPosition(initial.descriptionPosition);
    setIsDefault(initial.isDefault);
    setError(null);
    setExpandedId(null);
  }, [
    initialId,
    initial.body,
    initial.defaultChecklist,
    initial.descriptionPosition,
    initial.fields,
    initial.isDefault,
    initial.name,
  ]);

  const usedFieldIds = new Set(fields.map((f) => f.id));

  const addPreset = (preset: CardFieldDef) => {
    if (usedFieldIds.has(preset.id)) return;
    setFields((prev) => [...prev, preset]);
  };

  const addCustom = (draft: { label: string; type: CardFieldType; group: CardFieldGroup }) => {
    const id = generateCustomFieldId(draft.label, usedFieldIds);
    const def: CardFieldDef = {
      id,
      label: draft.label.trim(),
      type: draft.type,
      group: draft.group,
      ...(draft.type === 'select' ? { options: ['Option 1'] } : {}),
    };
    setFields((prev) => [...prev, def]);
    setExpandedId(id);
  };

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const moveField = (id: string, direction: -1 | 1) => {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      if (item) next.splice(target, 0, item);
      return next;
    });
  };

  const patchField = (id: string, patch: Partial<CardFieldDef>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? ({ ...f, ...patch } as CardFieldDef) : f)));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = {
        name,
        body,
        fields,
        defaultChecklist: checklist,
        descriptionPosition,
        isDefault,
      };
      const editId = initial.id;
      const res =
        mode === 'create' || !editId
          ? await createCardTemplate(payload)
          : await updateCardTemplate({ id: editId, ...payload });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onSaved(res.id);
    });
  };

  const remove = () => {
    const editId = initial.id;
    if (!editId) return;
    if (!window.confirm('Supprimer ce template ?')) return;
    startTransition(async () => {
      const res = await deleteCardTemplate({ id: editId });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onDeleted?.();
    });
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-5 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)]"
    >
      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
        <div>
          <label className="field-label" htmlFor="tpl-name">
            Nom du template
          </label>
          <input
            id="tpl-name"
            type="text"
            required
            maxLength={120}
            placeholder="Ex. Brief Social Media"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field-input"
          />
        </div>
        <label className="flex items-center gap-2 whitespace-nowrap text-xs font-bold">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Template par défaut
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={pending || name.trim().length === 0}
          >
            {pending ? 'Enregistrement…' : mode === 'create' ? 'Créer' : 'Enregistrer'}
          </button>
          {mode === 'edit' ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--color-danger)' }}
            >
              Supprimer
            </button>
          ) : null}
          {onCancel ? (
            <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
              Annuler
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
        <section>
          <div className="field-label">Champs de la carte ({fields.length})</div>
          {fields.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[color:var(--color-border-light)] p-4 text-xs text-[color:var(--color-text-muted)]">
              Aucun champ. Ajoutez-en depuis le panneau de droite.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {fields.map((f, idx) => (
                <li
                  key={f.id}
                  className="rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)]"
                >
                  <header className="grid grid-cols-[auto_auto_1fr_auto_auto_auto] items-center gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                      aria-label={expandedId === f.id ? 'Réduire' : 'Modifier'}
                      className="rounded-md px-1.5 py-0.5 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)]"
                    >
                      {expandedId === f.id ? '▾' : '▸'}
                    </button>
                    <FieldTypeBadge type={f.type} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{f.label}</div>
                      {f.type === 'select' && f.options && f.options.length > 0 ? (
                        <div className="mt-0.5 truncate text-[11px] text-[color:var(--color-text-muted)]">
                          {f.options.join(' · ')}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => moveField(f.id, -1)}
                      disabled={idx === 0}
                      aria-label="Monter"
                      className="rounded-md px-2 py-1 text-xs hover:bg-[color:var(--color-bg-hover)] disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(f.id, 1)}
                      disabled={idx === fields.length - 1}
                      aria-label="Descendre"
                      className="rounded-md px-2 py-1 text-xs hover:bg-[color:var(--color-bg-hover)] disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeField(f.id)}
                      aria-label={`Retirer ${f.label}`}
                      className="rounded-md px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-danger-bg)] hover:text-[color:var(--color-danger)]"
                    >
                      ×
                    </button>
                  </header>
                  {expandedId === f.id ? (
                    <FieldEditPanel field={f} onPatch={(p) => patchField(f.id, p)} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <div className="field-label">Quick add</div>
          <div className="flex flex-col gap-3">
            {CARD_FIELD_GROUPS.filter((g) => g.id !== 'custom').map((group) => {
              const presets = CARD_FIELD_PRESETS.filter((f) => f.group === group.id);
              return (
                <div key={group.id}>
                  <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                    {group.label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((p) => {
                      const used = usedFieldIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={used}
                          onClick={() => addPreset(p)}
                          className="rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2.5 py-1 text-[11px] font-bold transition hover:border-[color:var(--color-accent-primary)] hover:text-[color:var(--color-accent-primary)] disabled:opacity-40"
                          title={used ? 'Déjà ajouté' : `Ajouter ${p.label}`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="my-4 h-px bg-[color:var(--color-border-light)]" />

          <CustomFieldForm onAdd={addCustom} />
        </aside>
      </div>

      {/* Description block placement + optional intro markdown */}
      <div className="grid gap-3 md:grid-cols-[1fr_240px]">
        <div>
          <label className="field-label" htmlFor="tpl-body">
            Introduction (optionnel, markdown)
          </label>
          <textarea
            id="tpl-body"
            rows={3}
            maxLength={8000}
            placeholder="Texte affiché en haut du brief de la carte. Laissez vide pour ignorer."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="field-input"
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5 }}
          />
        </div>
        <label className="grid gap-1">
          <span className="field-label">Position de la description carte</span>
          <select
            value={descriptionPosition}
            onChange={(e) =>
              setDescriptionPosition(e.target.value as CardTemplateDescriptionPosition)
            }
            className="field-select"
          >
            {DESCRIPTION_POSITIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-[color:var(--color-text-muted)]">
            Où afficher le champ Description de la carte par rapport aux champs structurés.
          </span>
        </label>
      </div>

      {/* Default checklist */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="field-label" style={{ marginBottom: 0 }}>
            Checklist par défaut ({checklist.length})
          </div>
          <button
            type="button"
            onClick={() => setChecklist((prev) => [...prev, ''])}
            className="text-xs font-bold text-[color:var(--color-accent-primary)] underline"
          >
            + Item
          </button>
        </div>
        {checklist.length === 0 ? (
          <p className="text-xs text-[color:var(--color-text-muted)]">
            Aucun item. La checklist sera vide par défaut sur les nouvelles cartes.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {checklist.map((item, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={200}
                  value={item}
                  placeholder={`Item ${idx + 1}`}
                  onChange={(e) =>
                    setChecklist((prev) => {
                      const next = [...prev];
                      next[idx] = e.target.value;
                      return next;
                    })
                  }
                  className="field-input"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => setChecklist((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label="Retirer"
                  className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)]"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

// ---------- Inline field editor ------------------------------------------

function FieldEditPanel({
  field,
  onPatch,
}: {
  field: CardFieldDef;
  onPatch: (patch: Partial<CardFieldDef>) => void;
}) {
  return (
    <div className="grid gap-3 border-t border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-4">
      <div className="grid gap-2 md:grid-cols-[1fr_180px]">
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
            Libellé
          </span>
          <input
            type="text"
            maxLength={120}
            value={field.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            className="field-input"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
            Groupe
          </span>
          <select
            value={field.group ?? 'custom'}
            onChange={(e) => onPatch({ group: e.target.value as CardFieldGroup })}
            className="field-select"
          >
            {CARD_FIELD_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {field.type === 'select' ? <OptionsEditor field={field} onPatch={onPatch} /> : null}

      {field.type === 'text' || field.type === 'longtext' || field.type === 'link' ? (
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
            Placeholder (optionnel)
          </span>
          <input
            type="text"
            maxLength={200}
            value={field.placeholder ?? ''}
            onChange={(e) => onPatch({ placeholder: e.target.value })}
            className="field-input"
          />
        </label>
      ) : null}
    </div>
  );
}

function OptionsEditor({
  field,
  onPatch,
}: {
  field: CardFieldDef;
  onPatch: (patch: Partial<CardFieldDef>) => void;
}) {
  const [draft, setDraft] = useState('');
  const options = field.options ?? [];

  const addOption = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed.length > 80) return;
    if (options.includes(trimmed)) return;
    onPatch({ options: [...options, trimmed] });
    setDraft('');
  };

  const updateOption = (idx: number, next: string) => {
    onPatch({
      options: options.map((o, i) => (i === idx ? next : o)),
    });
  };

  const removeOption = (idx: number) => {
    onPatch({ options: options.filter((_, i) => i !== idx) });
  };

  const moveOption = (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    const [item] = next.splice(idx, 1);
    if (item !== undefined) next.splice(target, 0, item);
    onPatch({ options: next });
  };

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
        Options ({options.length})
      </div>
      {options.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1">
          {options.map((opt, idx) => (
            <li key={idx} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1.5">
              <input
                type="text"
                maxLength={80}
                value={opt}
                onChange={(e) => updateOption(idx, e.target.value)}
                className="field-input"
              />
              <button
                type="button"
                onClick={() => moveOption(idx, -1)}
                disabled={idx === 0}
                aria-label="Monter"
                className="rounded-md px-2 py-1 text-xs hover:bg-[color:var(--color-bg-hover)] disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveOption(idx, 1)}
                disabled={idx === options.length - 1}
                aria-label="Descendre"
                className="rounded-md px-2 py-1 text-xs hover:bg-[color:var(--color-bg-hover)] disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeOption(idx)}
                aria-label="Retirer l'option"
                className="rounded-md px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-danger-bg)] hover:text-[color:var(--color-danger)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="text"
          maxLength={80}
          placeholder="Nouvelle option…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addOption();
            }
          }}
          className="field-input"
        />
        <button
          type="button"
          onClick={addOption}
          disabled={draft.trim().length === 0}
          className="btn btn-primary btn-sm"
        >
          + Ajouter
        </button>
      </div>
    </div>
  );
}

// ---------- Custom field creator ----------------------------------------

function CustomFieldForm({
  onAdd,
}: {
  onAdd: (draft: { label: string; type: CardFieldType; group: CardFieldGroup }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CardFieldType>('text');
  const [group, setGroup] = useState<CardFieldGroup>('custom');

  const submit = () => {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    onAdd({ label: trimmed, type, group });
    setLabel('');
    setType('text');
    setGroup('custom');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-[color:var(--color-accent-primary)] bg-transparent py-2 text-xs font-bold text-[color:var(--color-accent-primary)] transition hover:bg-[image:var(--accent-gradient-soft)]"
      >
        + Champ personnalisé
      </button>
    );
  }

  return (
    <div
      onKeyDown={(e) => {
        // Enter on the label input → create (mirrors the form behaviour we
        // can't use here, since this lives inside the outer TemplateForm).
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          submit();
        }
      }}
      className="grid gap-2 rounded-lg border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3"
    >
      <div className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        Nouveau champ
      </div>
      <input
        autoFocus
        type="text"
        maxLength={120}
        placeholder="Libellé (ex. Brand voice)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="field-input"
      />
      <div className="grid gap-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
          Type
        </span>
        <div className="flex flex-col gap-1">
          {CARD_FIELD_TYPES.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="custom-field-type"
                value={t.id}
                checked={type === t.id}
                onChange={() => setType(t.id)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>
      <label className="grid gap-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
          Groupe
        </span>
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value as CardFieldGroup)}
          className="field-select"
        >
          {CARD_FIELD_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={label.trim().length === 0}
          className="btn btn-primary btn-sm"
        >
          Créer
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setLabel('');
          }}
          className="btn btn-ghost btn-sm"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// ---------- Type badge --------------------------------------------------

function FieldTypeBadge({ type }: { type: CardFieldType }) {
  const map: Record<CardFieldType, { label: string; bg: string }> = {
    text: { label: 'Text', bg: 'var(--color-info-bg)' },
    longtext: { label: 'Long', bg: 'var(--color-info-bg)' },
    select: { label: 'Select', bg: 'var(--color-warning-bg)' },
    link: { label: 'Lien', bg: 'var(--color-success-bg)' },
    checkbox: { label: 'Bool', bg: 'var(--color-bg-hover)' },
    date: { label: 'Date', bg: 'var(--color-info-bg)' },
    number: { label: '123', bg: 'var(--color-bg-hover)' },
  };
  const { label, bg } = map[type];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.5px]"
      style={{ background: bg, color: 'var(--text-soft)' }}
    >
      {label}
    </span>
  );
}
