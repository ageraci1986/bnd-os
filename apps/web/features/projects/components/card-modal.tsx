'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from '@nexushub/ui';
import { customCategoryColor } from '../lib/custom-category-color';
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
import { CardCommentsThread } from './card-comments-thread';
import type { CardCommentDTO } from '../lib/comment-dto';

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
    readonly columnId: string;
    readonly columnName: string;
    readonly columnIsBlocked: boolean;
    readonly nextColumnName: string | null;
    readonly categoryTag: string | null;
    readonly checklist: readonly ChecklistItemDTO[];
    readonly assignees: readonly CardAssignment[];
    readonly templateId: string | null;
    readonly templateItems: readonly CardTemplateItem[];
    readonly fieldValues: Record<string, string>;
    readonly comments: readonly CardCommentDTO[];
  };
  readonly availableTemplates: readonly TemplateOption[];
  /**
   * Optional close handler. When provided, the modal calls this instead
   * of mutating the URL via router.replace — used by CardModalController
   * which manages its own state + URL via history.replaceState.
   */
  readonly onClose?: () => void;
  /**
   * True while the full detail (description, fields, checklist, …) is
   * still being fetched from the server. The header data (title, ref,
   * category) is already meaningful; everything else renders a skeleton.
   */
  readonly isLoading?: boolean;
  /**
   * Viewer mode: the modal body is wrapped in <fieldset disabled> so
   * every interactive control inside is disabled in one shot. The close
   * button stays interactive (escape hatch). Delete is also explicitly
   * hidden because focus-managed buttons can sometimes bypass fieldset.
   */
  readonly isReadOnly?: boolean;
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
  onClose,
  isLoading = false,
  isReadOnly = false,
}: CardModalProps) {
  const router = useRouter();
  const [items, setItems] = useState<readonly ChecklistItemDTO[]>(card.checklist);
  const [_pending, startTransition] = useTransition();

  const close = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('card');
    url.searchParams.delete('new');
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false });
  }, [onClose, router]);

  // Once mounted with `?new=1`, drop the param so a refresh / back nav
  // doesn't keep re-selecting the title. Skip when a controller manages
  // the URL itself.
  useEffect(() => {
    if (!isNew || onClose) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('new');
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false });
  }, [isNew, onClose, router]);

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

  // Split the card's checklist into the two surfaces:
  //  - stepItems = items seeded by the current column's stepChecklist
  //    (PRD §7.2 ext). Filtered to ONLY the current column so other
  //    columns' step items stay hidden but persisted.
  //  - ownItems = manually-added items + items seeded by the card's
  //    template (no columnSourceId).
  // Items belonging to OTHER columns are completely hidden but kept in
  // DB so their checked state persists if the card returns to them.
  const stepItems = items.filter((i) => i.columnSourceId === card.columnId);
  const ownItems = items.filter((i) => i.columnSourceId === null);
  const visibleItems = [...ownItems, ...stepItems];
  const checked = visibleItems.filter((i) => i.isChecked).length;
  const allChecked = visibleItems.length > 0 && checked === visibleItems.length;
  const progress =
    visibleItems.length === 0 ? 0 : Math.round((checked / visibleItems.length) * 100);
  // The regular Checklist section only renders when the template
  // explicitly includes a `checklist` item.
  const templateHasChecklist = card.templateItems.some((i) => i.type === 'checklist');
  const showOwnChecklist = templateHasChecklist;
  const showStepChecklist = stepItems.length > 0;

  return (
    <>
      <div className="modal-backdrop" onClick={close} />
      <article className="modal" role="dialog" aria-modal="true" aria-labelledby="card-modal-title">
        <header className="modal-head">
          <fieldset
            disabled={isReadOnly}
            className="contents"
            style={{ border: 0, padding: 0, margin: 0 }}
          >
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
              {allChecked && !isReadOnly ? (
                <AutoAdvanceBanner
                  cardId={card.id}
                  nextColumnName={card.nextColumnName}
                  onComplete={close}
                />
              ) : null}
            </div>
          </fieldset>
          <button type="button" className="modal-close" onClick={close} aria-label="Fermer">
            ✕
          </button>
        </header>

        <fieldset
          disabled={isReadOnly}
          className="contents"
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <div className="modal-body">
            <div className="modal-main">
              {isLoading ? (
                <ModalBodySkeleton />
              ) : (
                <TemplateItemsRender
                  cardId={card.id}
                  items={card.templateItems}
                  fieldValues={card.fieldValues}
                  description={card.description ?? ''}
                />
              )}

              {/* Combined progress bar across step + own items, displayed
                once above the two checklist sections. */}
              {!isLoading && (showStepChecklist || showOwnChecklist) ? (
                <section className="modal-section">
                  <div className="checklist-meta">
                    <div className="section-label" style={{ marginBottom: 0 }}>
                      Progression
                    </div>
                    <div className="checklist-count">
                      {checked} / {visibleItems.length}
                      {allChecked ? ' ✓' : ''}
                    </div>
                  </div>
                  {visibleItems.length > 0 ? (
                    <p className="checklist-hint">
                      Auto-progression — la carte avance dès que tout est coché (checklist + step).
                    </p>
                  ) : null}
                  <div
                    style={{
                      height: 4,
                      background: 'var(--color-border-light)',
                      borderRadius: 9999,
                      margin: '10px 0 0',
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
                </section>
              ) : null}

              <section className="modal-section" hidden={isLoading || !showStepChecklist}>
                <div className="checklist-meta">
                  <div className="section-label" style={{ marginBottom: 0 }}>
                    Step checklist
                  </div>
                  <div className="checklist-count">
                    {stepItems.filter((i) => i.isChecked).length} / {stepItems.length}
                  </div>
                </div>
                <p className="checklist-hint">
                  Étapes attendues dans la colonne « {card.columnName} ».
                </p>
                <div>
                  {stepItems.map((item) => (
                    <CheckRow
                      key={item.id}
                      item={item}
                      onToggle={(isChecked) => {
                        setItems((prev) =>
                          prev.map((i) => (i.id === item.id ? { ...i, isChecked } : i)),
                        );
                        startTransition(() => {
                          void toggleChecklistItem({ itemId: item.id, isChecked }).then((res) => {
                            if (!res.ok) {
                              window.alert(res.message);
                              setItems((prev) =>
                                prev.map((i) =>
                                  i.id === item.id ? { ...i, isChecked: !isChecked } : i,
                                ),
                              );
                            }
                          });
                        });
                      }}
                      onDelete={() => {
                        // Step items are template-driven; user can delete
                        // them locally on this card if irrelevant.
                        const snapshot = items;
                        setItems((prev) => prev.filter((i) => i.id !== item.id));
                        startTransition(() => {
                          void deleteChecklistItem({ itemId: item.id }).then((res) => {
                            if (!res.ok) {
                              window.alert(res.message);
                              setItems(snapshot);
                            }
                          });
                        });
                      }}
                    />
                  ))}
                </div>
              </section>

              <section className="modal-section" hidden={isLoading || !showOwnChecklist}>
                <div className="checklist-meta">
                  <div className="section-label" style={{ marginBottom: 0 }}>
                    Checklist
                  </div>
                  <div className="checklist-count">
                    {ownItems.filter((i) => i.isChecked).length} / {ownItems.length}
                  </div>
                </div>
                <div>
                  {ownItems.map((item) => (
                    <CheckRow
                      key={item.id}
                      item={item}
                      onToggle={(isChecked) => {
                        setItems((prev) =>
                          prev.map((i) => (i.id === item.id ? { ...i, isChecked } : i)),
                        );
                        startTransition(() => {
                          void toggleChecklistItem({ itemId: item.id, isChecked }).then((res) => {
                            if (!res.ok) {
                              window.alert(res.message);
                              setItems((prev) =>
                                prev.map((i) =>
                                  i.id === item.id ? { ...i, isChecked: !isChecked } : i,
                                ),
                              );
                            }
                          });
                        });
                      }}
                      onDelete={() => {
                        const snapshot = items;
                        setItems((prev) => prev.filter((i) => i.id !== item.id));
                        startTransition(() => {
                          void deleteChecklistItem({ itemId: item.id }).then((res) => {
                            if (!res.ok) {
                              window.alert(res.message);
                              setItems(snapshot);
                            }
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

              {!isLoading ? (
                <CardCommentsThread
                  cardId={card.id}
                  csrfToken={csrfToken}
                  comments={card.comments}
                  canPost={!isReadOnly}
                />
              ) : null}
            </div>

            <aside className="modal-side">
              {isLoading ? <ModalSideSkeleton /> : null}
              <div className="side-row" hidden={isLoading}>
                <div className="side-label">Colonne actuelle</div>
                <div className="col-current">
                  <span className="dot" /> {card.columnName}
                </div>
                {card.nextColumnName ? (
                  <div className="next-col">→ {card.nextColumnName} · auto</div>
                ) : null}
              </div>

              <div className="side-row" hidden={isLoading}>
                <div className="side-label">Assignés{assignments(card.assignees)}</div>
                <AssigneesSide
                  cardId={card.id}
                  assignments={card.assignees}
                  members={workspaceMembers}
                />
              </div>

              <div className="side-row" hidden={isLoading}>
                <div className="side-label">Catégorie</div>
                <CategorySelector
                  cardId={card.id}
                  initial={card.categoryTag}
                  customCategories={customCategories}
                />
              </div>

              <div className="side-row" hidden={isLoading}>
                <div className="side-label">Échéance</div>
                <DueDateInput cardId={card.id} initial={card.dueDate} onAfterUpdate={close} />
              </div>

              <div className="side-row" hidden={isLoading}>
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

              {!isReadOnly ? (
                <div className="side-row" hidden={isLoading}>
                  <div className="side-label">Actions</div>
                  <div className="side-actions">
                    <DeleteCardButton cardId={card.id} csrfToken={csrfToken} onDeleted={close} />
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        </fieldset>

        <footer className="modal-foot">
          <span className="modal-foot-info">
            {isReadOnly
              ? '✦ Mode lecture seule — vous ne pouvez pas modifier cette carte.'
              : '✦ Sauvegarde automatique — vos modifications sont enregistrées au fil de l’eau.'}
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
      if (!res.ok) {
        window.alert(res.message);
        return;
      }
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
      // Manual adds are always "own" items; the step-checklist comes from
      // the column-source seeding done server-side.
      columnSourceId: null,
    };
    onOptimisticAdd(optimistic);
    setTitle('');
    startTransition(() => {
      void createChecklistItem({ cardId, title: trimmed }).then((res) => {
        if (!res.ok) {
          window.alert(res.message);
          onError(tempId);
        } else {
          onConfirm(res.items);
        }
      });
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
            <CustomCategoryPill label={label} />
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
            <CustomCategoryPill label={active} />
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

// ---------- Skeleton placeholders -----------------------------------------
// Rendered while the controller fetches the full card detail. The header
// (title, ref, category) stays interactive — only the body that depends on
// the server response is replaced by shimmer blocks.

function ModalBodySkeleton() {
  return (
    <>
      <section className="modal-section">
        <div className="section-label">Description</div>
        <div className="nx-skeleton" style={{ height: 14, marginBottom: 8 }} />
        <div className="nx-skeleton" style={{ height: 14, marginBottom: 8, width: '92%' }} />
        <div className="nx-skeleton" style={{ height: 14, width: '70%' }} />
      </section>
      <section className="modal-section">
        <div className="section-label">Brief</div>
        <div className="nx-skeleton" style={{ height: 36, marginBottom: 10 }} />
        <div className="nx-skeleton" style={{ height: 36, marginBottom: 10 }} />
        <div className="nx-skeleton" style={{ height: 36 }} />
      </section>
    </>
  );
}

function ModalSideSkeleton() {
  const rows = [
    { labelW: 90, blockH: 18 },
    { labelW: 70, blockH: 60 },
    { labelW: 80, blockH: 28 },
    { labelW: 80, blockH: 28 },
    { labelW: 70, blockH: 36 },
  ];
  return (
    <>
      {rows.map((r, idx) => (
        <div className="side-row" key={idx}>
          <div className="nx-skeleton" style={{ height: 10, width: r.labelW, marginBottom: 8 }} />
          <div className="nx-skeleton" style={{ height: r.blockH }} />
        </div>
      ))}
    </>
  );
}

/**
 * Pill rendering for a workspace-defined (custom) category. The colour
 * is derived deterministically from the label so the same name always
 * renders the same hue.
 */
function CustomCategoryPill({ label }: { label: string }) {
  const c = customCategoryColor(label);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px]"
      style={{ background: c.bg, color: c.fg }}
    >
      {label}
    </span>
  );
}
