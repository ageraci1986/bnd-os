'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from '@nexushub/ui';
import {
  AUTO_ADVANCE_DELAY_MS,
  BUILTIN_CARD_CATEGORIES,
  isBuiltinCardCategory,
  type BuiltinCardCategoryId,
} from '@nexushub/domain';
import type { CardTemplateItem } from '@nexushub/domain';
import { AssigneesSide, type CardAssignment, type WorkspaceMemberOption } from './assignees-side';
import { TemplateItemsRender } from './template-items-render';
import { TemplatePicker, type TemplateOption } from './template-picker';
import {
  createChecklistItem,
  deleteChecklistItem,
  toggleChecklistItem,
  type ChecklistItemDTO,
} from '../actions/checklist';
import { advanceCard } from '../actions/advance-card';
import { updateCard } from '../actions/update-card';
import { updateCardDueDate } from '../actions/update-card-due-date';
import { deleteCard } from '../actions/delete-card';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';

export interface CardModalProps {
  readonly csrfToken: string;
  readonly workspaceName: string;
  readonly projectName: string;
  readonly customCategories: readonly string[];
  /** When true (i.e. ?new=1), the title input autofocuses + selects on mount. */
  readonly isNew: boolean;
  readonly workspaceMembers: readonly WorkspaceMemberOption[];
  readonly card: {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    readonly dueDate: string | null;
    readonly shortRef: number;
    readonly columnName: string;
    readonly columnIsBlocked: boolean;
    readonly nextColumnName: string | null;
    readonly categoryTag: string | null;
    readonly checklist: readonly ChecklistItemDTO[];
    readonly assignees: readonly CardAssignment[];
    readonly templateId: string | null;
    readonly templateItems: readonly CardTemplateItem[];
    readonly fieldValues: Record<string, string>;
  };
  readonly availableTemplates: readonly TemplateOption[];
}

/**
 * Card detail modal (PRD §6 + §8.2). URL-driven via `?card=<id>` so the
 * modal is shareable and back-button friendly. Layout follows
 * mockups/06-card-modal.html: main scrollable area + 280px side rail.
 */
export function CardModal({
  csrfToken,
  workspaceName,
  projectName,
  customCategories,
  isNew,
  workspaceMembers,
  availableTemplates,
  card,
}: CardModalProps) {
  const router = useRouter();
  const [items, setItems] = useState<readonly ChecklistItemDTO[]>(card.checklist);
  const [_pending, startTransition] = useTransition();

  const close = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('card');
    url.searchParams.delete('new');
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false });
  }, [router]);

  // Once mounted with `?new=1`, drop the param so a refresh / back nav
  // doesn't keep re-selecting the title. Router included in deps — it's
  // a stable reference from useRouter().
  useEffect(() => {
    if (!isNew) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('new');
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false });
  }, [isNew, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    setItems(card.checklist);
  }, [card.checklist]);

  const allChecked = items.length > 0 && items.every((i) => i.isChecked);
  const checked = items.filter((i) => i.isChecked).length;
  const progress = items.length === 0 ? 0 : Math.round((checked / items.length) * 100);

  return (
    <>
      <div className="modal-backdrop" onClick={close} />
      <article className="modal" role="dialog" aria-modal="true" aria-labelledby="card-modal-title">
        <header className="modal-head">
          <div>
            <div className="modal-breadcrumb">
              <span>{workspaceName}</span>
              <span>/</span>
              <span>{projectName}</span>
              <span>/</span>
              <strong>Carte #{String(card.shortRef).padStart(3, '0')}</strong>
            </div>
            <CardTitleInput cardId={card.id} initial={card.title} autoSelect={isNew} />
            {card.columnIsBlocked ? (
              <BlockedBanner cardId={card.id} dueDate={card.dueDate} />
            ) : null}
            {allChecked ? (
              <AutoAdvanceBanner
                cardId={card.id}
                nextColumnName={card.nextColumnName}
                onComplete={close}
              />
            ) : null}
          </div>
          <button type="button" className="modal-close" onClick={close} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <div className="modal-main">
            <TemplateItemsRender
              cardId={card.id}
              items={card.templateItems}
              fieldValues={card.fieldValues}
              description={card.description ?? ''}
            />

            <section className="modal-section">
              <div className="checklist-meta">
                <div className="section-label" style={{ marginBottom: 0 }}>
                  Checklist
                </div>
                <div className="checklist-count">
                  {checked} / {items.length}
                  {allChecked ? ' ✓' : ''}
                </div>
              </div>
              {items.length > 0 ? (
                <p className="checklist-hint">
                  Auto-progression active — la carte avance dès que tout est coché.
                </p>
              ) : null}
              <div
                style={{
                  height: 4,
                  background: 'var(--color-border-light)',
                  borderRadius: 9999,
                  margin: '10px 0 14px',
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: allChecked ? 'var(--color-success)' : 'var(--accent-gradient)',
                    borderRadius: 9999,
                    transition: 'width 0.25s',
                  }}
                />
              </div>
              <div>
                {items.map((item) => (
                  <CheckRow
                    key={item.id}
                    item={item}
                    onToggle={(isChecked) => {
                      // Optimistic: flip locally, fire-and-forget the save.
                      // We do NOT overwrite from the server response — that
                      // would race against subsequent quick toggles. Server
                      // is the eventual source of truth; on error we revert.
                      setItems((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, isChecked } : i)),
                      );
                      startTransition(() => {
                        void toggleChecklistItem({ itemId: item.id, isChecked }).catch(() => {
                          setItems((prev) =>
                            prev.map((i) =>
                              i.id === item.id ? { ...i, isChecked: !isChecked } : i,
                            ),
                          );
                        });
                      });
                    }}
                    onDelete={() => {
                      // Optimistic remove. On error, restore the original.
                      const snapshot = items;
                      setItems((prev) => prev.filter((i) => i.id !== item.id));
                      startTransition(() => {
                        void deleteChecklistItem({ itemId: item.id }).catch(() => {
                          setItems(snapshot);
                        });
                      });
                    }}
                  />
                ))}
              </div>
              <ChecklistAdder
                cardId={card.id}
                onOptimisticAdd={(temp) => setItems((prev) => [...prev, temp])}
                onConfirm={(updated) => setItems(updated)}
                onError={(tempId) => setItems((prev) => prev.filter((i) => i.id !== tempId))}
              />
            </section>
          </div>

          <aside className="modal-side">
            <div className="side-row">
              <div className="side-label">Colonne actuelle</div>
              <div className="col-current">
                <span className="dot" /> {card.columnName}
              </div>
              {card.nextColumnName ? (
                <div className="next-col">→ {card.nextColumnName} · auto</div>
              ) : null}
            </div>

            <div className="side-row">
              <div className="side-label">Assignés{assignments(card.assignees)}</div>
              <AssigneesSide
                cardId={card.id}
                assignments={card.assignees}
                members={workspaceMembers}
              />
            </div>

            <div className="side-row">
              <div className="side-label">Catégorie</div>
              <CategorySelector
                cardId={card.id}
                initial={card.categoryTag}
                customCategories={customCategories}
              />
            </div>

            <div className="side-row">
              <div className="side-label">Échéance</div>
              <DueDateInput cardId={card.id} initial={card.dueDate} onAfterUpdate={close} />
            </div>

            <div className="side-row">
              <div className="side-label">Template</div>
              <TemplatePicker
                cardId={card.id}
                currentTemplateId={card.templateId}
                templates={availableTemplates}
              />
              <p className="mt-1 text-[10px] text-[color:var(--color-text-muted)]">
                Changer le template ré-organise les champs structurés. Les valeurs des champs
                conservés sont préservées.
              </p>
            </div>

            <div className="side-row">
              <div className="side-label">Actions</div>
              <div className="side-actions">
                <DeleteCardButton cardId={card.id} csrfToken={csrfToken} onDeleted={close} />
              </div>
            </div>
          </aside>
        </div>

        <footer className="modal-foot">
          <span className="modal-foot-info">
            ✦ Sauvegarde automatique — vos modifications sont enregistrées au fil de l’eau.
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={close}>
            Fermer
          </button>
        </footer>
      </article>
    </>
  );
}

function assignments(list: readonly CardAssignment[]): string {
  return list.length === 0 ? '' : ` · ${list.length}`;
}

// ---------- Title (debounced save) -----------------------------------------

function CardTitleInput({
  cardId,
  initial,
  autoSelect,
}: {
  cardId: string;
  initial: string;
  autoSelect: boolean;
}) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // When the modal opens for a freshly-created card (`?new=1`), focus the
  // title input and select the placeholder text so the user can just type
  // to replace it.
  useEffect(() => {
    if (!autoSelect) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [autoSelect]);

  const flush = useCallback(
    (next: string) => {
      void updateCard({ cardId, title: next }).catch(() => {
        // best-effort; the next save will overwrite
      });
    },
    [cardId],
  );

  return (
    <input
      ref={inputRef}
      id="card-modal-title"
      type="text"
      maxLength={200}
      className="card-title-input"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(next), 600);
      }}
      onBlur={() => {
        if (timer.current) clearTimeout(timer.current);
        if (value.trim().length > 0 && value !== initial) flush(value);
      }}
    />
  );
}

// ---------- Due date -------------------------------------------------------

function DueDateInput({
  cardId,
  initial,
  onAfterUpdate,
}: {
  cardId: string;
  initial: string | null;
  onAfterUpdate: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial ? initial.slice(0, 10) : '');
  const [pending, startTransition] = useTransition();

  const save = (next: string | null) => {
    startTransition(async () => {
      const res = await updateCardDueDate({ cardId, dueDate: next });
      if (res.autoBlocked) {
        window.alert('Échéance dépassée — la carte a été déplacée vers Bloqué.');
        onAfterUpdate();
      } else if (res.autoUnblocked) {
        window.alert('La carte est sortie de Bloqué.');
        onAfterUpdate();
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div>
      <input
        type="date"
        className="field-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          save(e.target.value || null);
        }}
        disabled={pending}
        style={{ width: '100%' }}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue('');
            save(null);
          }}
          disabled={pending}
          className="next-col"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginTop: 8,
            textDecoration: 'underline',
          }}
        >
          Retirer l'échéance
        </button>
      ) : null}
    </div>
  );
}

// ---------- Checklist row + adder -----------------------------------------

function CheckRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ChecklistItemDTO;
  onToggle: (isChecked: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div className={item.isChecked ? 'check-item done' : 'check-item'}>
      <button
        type="button"
        className="box"
        onClick={() => onToggle(!item.isChecked)}
        aria-pressed={item.isChecked}
        aria-label={item.isChecked ? 'Décocher' : 'Cocher'}
      >
        {item.isChecked ? '✓' : ''}
      </button>
      <span className="text">{item.title}</span>
      <button type="button" className="remove" onClick={onDelete} aria-label="Supprimer">
        ×
      </button>
    </div>
  );
}

function ChecklistAdder({
  cardId,
  onOptimisticAdd,
  onConfirm,
  onError,
}: {
  cardId: string;
  onOptimisticAdd: (temp: ChecklistItemDTO) => void;
  onConfirm: (items: readonly ChecklistItemDTO[]) => void;
  onError: (tempId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [, startTransition] = useTransition();

  const submit = () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    // Optimistic: render the new item immediately with a temp id, clear the
    // input so the user can chain Entrée. The server response replaces the
    // whole list (real ids); on error we yank the temp item out.
    const tempId = `tmp-${Math.random().toString(36).slice(2, 10)}`;
    const optimistic: ChecklistItemDTO = {
      id: tempId,
      title: trimmed,
      isChecked: false,
      position: Number.MAX_SAFE_INTEGER,
    };
    onOptimisticAdd(optimistic);
    setTitle('');
    startTransition(() => {
      void createChecklistItem({ cardId, title: trimmed })
        .then((res) => onConfirm(res.items))
        .catch(() => onError(tempId));
    });
  };

  return (
    <form
      className="check-add"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="check-add-plus" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </span>
      <input
        type="text"
        maxLength={200}
        placeholder="Ajouter un élément… (Entrée pour valider)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" disabled={title.trim().length === 0}>
        Ajouter
      </button>
    </form>
  );
}

// ---------- Category selector --------------------------------------------

function CategorySelector({
  cardId,
  initial,
  customCategories,
}: {
  cardId: string;
  initial: string | null;
  customCategories: readonly string[];
}) {
  // Local list so a freshly-coined custom category is rendered as a quick
  // pick immediately, without waiting for a server refresh.
  const [active, setActive] = useState<string | null>(initial);
  const [extra, setExtra] = useState<readonly string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const pick = (next: string | null) => {
    const previous = active;
    setActive(next);
    void updateCard({ cardId, categoryTag: next }).catch(() => setActive(previous));
  };

  const submitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed.length > 32) return;
    const previous = active;
    setActive(trimmed);
    if (!customCategories.includes(trimmed) && !extra.includes(trimmed)) {
      setExtra((prev) => [...prev, trimmed]);
    }
    setAdding(false);
    setDraft('');
    void updateCard({ cardId, categoryTag: trimmed }).catch(() => setActive(previous));
  };

  const allCustom = [...customCategories, ...extra.filter((t) => !customCategories.includes(t))];

  return (
    <div>
      <div className="category-pickrow">
        <button
          type="button"
          onClick={() => pick(null)}
          className={['category-pick', 'none', active === null && 'active']
            .filter(Boolean)
            .join(' ')}
        >
          Aucune
        </button>
        {BUILTIN_CARD_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => pick(c.id)}
            className={['category-pick', active === c.id && 'active'].filter(Boolean).join(' ')}
            aria-pressed={active === c.id}
          >
            <Tag variant={c.id as BuiltinCardCategoryId} size="sm">
              {c.label}
            </Tag>
          </button>
        ))}
        {allCustom.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => pick(label)}
            className={['category-pick', active === label && 'active'].filter(Boolean).join(' ')}
            aria-pressed={active === label}
          >
            <Tag variant="primary" size="sm">
              {label}
            </Tag>
          </button>
        ))}
        {active && !isBuiltinCardCategory(active) && !allCustom.includes(active) ? (
          <button
            type="button"
            className="category-pick active"
            aria-pressed
            onClick={() => pick(null)}
            title="Cliquer pour retirer"
          >
            <Tag variant="primary" size="sm">
              {active}
            </Tag>
          </button>
        ) : null}
      </div>
      {adding ? (
        <form onSubmit={submitCustom} className="category-add-form">
          <input
            autoFocus
            type="text"
            placeholder="Nom (max 32)"
            value={draft}
            maxLength={32}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft.trim().length === 0) setAdding(false);
            }}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={draft.trim().length === 0}
          >
            Créer
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="next-col"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          + Catégorie personnalisée
        </button>
      )}
    </div>
  );
}

// ---------- 1.8s auto-advance bandeau -------------------------------------

function AutoAdvanceBanner({
  cardId,
  nextColumnName,
  onComplete,
}: {
  cardId: string;
  nextColumnName: string | null;
  onComplete: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState<number>(AUTO_ADVANCE_DELAY_MS);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const left = Math.max(0, AUTO_ADVANCE_DELAY_MS - elapsed);
      setRemainingMs(left);
      if (left <= 0) clearInterval(tick);
    }, 100);
    const fire = setTimeout(() => {
      if (cancelled.current) return;
      void advanceCard({ cardId }).then((r) => {
        if (r.ok && r.moved) onComplete();
      });
    }, AUTO_ADVANCE_DELAY_MS);
    return () => {
      cancelled.current = true;
      clearTimeout(fire);
      clearInterval(tick);
    };
  }, [cardId, onComplete]);

  const cancel = () => {
    cancelled.current = true;
  };

  return (
    <div className="flow-banner" role="status">
      <span className="flow-banner-text">
        ✓ Checklist complète{nextColumnName ? ` · déplacement vers ` : ''}
        {nextColumnName ? <strong>{nextColumnName}</strong> : null} ·{' '}
        {(remainingMs / 1000).toFixed(1)}s
      </span>
      <button type="button" onClick={cancel}>
        Annuler
      </button>
    </div>
  );
}

// ---------- Blocked banner (PRD §10 #4) -----------------------------------

function BlockedBanner({ cardId, dueDate }: { cardId: string; dueDate: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="blocked-banner" role="alert">
      <span>
        ⚠ Carte bloquée — l'échéance {dueDate ? `du ${dueDate.slice(0, 10)} ` : ''}est dépassée.
      </span>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={pending}
        onClick={() => {
          const next = window.prompt(
            'Nouvelle échéance (AAAA-MM-JJ) ou laissez vide pour retirer :',
          );
          if (next === null) return;
          startTransition(async () => {
            await updateCardDueDate({ cardId, dueDate: next.trim() || null });
            router.refresh();
          });
        }}
      >
        Modifier l'échéance
      </button>
    </div>
  );
}

// ---------- Delete (rendered in side actions) -----------------------------

function DeleteCardButton({
  cardId,
  csrfToken,
  onDeleted,
}: {
  cardId: string;
  csrfToken: string;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={async (fd) => {
        if (!window.confirm('Supprimer définitivement cette carte ?')) return;
        startTransition(async () => {
          await deleteCard({ status: 'idle' }, fd);
          onDeleted();
        });
      }}
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <input type="hidden" name="cardId" value={cardId} />
      <button type="submit" disabled={pending} className="danger">
        {pending ? 'Suppression…' : 'Supprimer la carte'}
      </button>
    </form>
  );
}
