'use client';
import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CARD_VARIABLE_GROUPS, CARD_VARIABLES, DEFAULT_CARD_TEMPLATE_BODY } from '@nexushub/domain';
import { createCardTemplate, deleteCardTemplate, updateCardTemplate } from './actions';

export interface CardTemplateOption {
  readonly id: string;
  readonly name: string;
  readonly body: string;
  readonly defaultChecklist: readonly string[];
  readonly isDefault: boolean;
}

export interface CardTemplateEditorProps {
  readonly templates: readonly CardTemplateOption[];
}

export function CardTemplateEditor({ templates }: CardTemplateEditorProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null);
  const [creating, setCreating] = useState(false);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

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
            Aucun template. Créez-en un pour pré-remplir le brief de vos cartes.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(t.id);
                    setCreating(false);
                  }}
                  className={[
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition',
                    t.id === selectedId
                      ? 'border-[color:var(--color-accent-primary)] bg-[color:var(--accent-gradient-soft)] font-bold'
                      : 'border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] font-medium hover:border-[color:var(--color-accent-primary)]',
                  ].join(' ')}
                >
                  <span className="truncate">{t.name}</span>
                  {t.isDefault ? (
                    <span className="ml-2 rounded-full bg-[color:var(--color-accent-primary)] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.5px] text-white">
                      Défaut
                    </span>
                  ) : null}
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
              body: DEFAULT_CARD_TEMPLATE_BODY,
              defaultChecklist: [],
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
    defaultChecklist: readonly string[];
    isDefault: boolean;
  };
  onSaved: (id: string) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
}

function TemplateForm({ mode, initial, onSaved, onDeleted, onCancel }: TemplateFormProps) {
  const [name, setName] = useState(initial.name);
  const [body, setBody] = useState(initial.body);
  const [checklist, setChecklist] = useState<string[]>([...initial.defaultChecklist]);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset form when switching templates. We watch `initial.id` only —
  // when the parent renders a different template, swap the local state.
  const initialId = initial.id;
  useEffect(() => {
    setName(initial.name);
    setBody(initial.body);
    setChecklist([...initial.defaultChecklist]);
    setIsDefault(initial.isDefault);
    setError(null);
  }, [initialId, initial.body, initial.defaultChecklist, initial.isDefault, initial.name]);

  const insertSnippet = (snippet: string) => {
    const el = bodyRef.current;
    if (!el) {
      setBody((prev) => prev + (prev.endsWith('\n') || prev.length === 0 ? '' : '\n') + snippet);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const sep = before.length === 0 || before.endsWith('\n') ? '' : '\n';
    const next = before + sep + snippet + after;
    setBody(next);
    // Reset cursor right after the inserted snippet on the next paint.
    queueMicrotask(() => {
      const pos = before.length + sep.length + snippet.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = {
        name,
        body,
        defaultChecklist: checklist,
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
      className="grid gap-4 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)]"
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

      <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
        <div>
          <div className="field-label">Corps (markdown)</div>
          <textarea
            ref={bodyRef}
            rows={18}
            maxLength={16000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="field-input"
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5 }}
          />
        </div>
        <aside>
          <div className="field-label">+ Insérer une variable</div>
          <div className="flex flex-col gap-3">
            {CARD_VARIABLE_GROUPS.map((group) => (
              <div key={group.id}>
                <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                  {group.label}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CARD_VARIABLES.filter((v) => v.group === group.id).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => insertSnippet(v.snippet)}
                      className="rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2.5 py-1 text-[11px] font-bold transition hover:border-[color:var(--color-accent-primary)] hover:text-[color:var(--color-accent-primary)]"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

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
