'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from '@nexushub/ui';
import {
  AUTO_ADVANCE_DELAY_MS,
  BUILTIN_CARD_CATEGORIES,
  type BuiltinCardCategoryId,
} from '@nexushub/domain';
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
  readonly card: {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    readonly dueDate: string | null;
    readonly shortRef: number;
    readonly columnName: string;
    readonly columnIsBlocked: boolean;
    readonly categoryTag: string | null;
    readonly checklist: readonly ChecklistItemDTO[];
  };
}

/**
 * Card detail modal (PRD §6 + §8.2). URL-driven via `?card=<id>` so the
 * modal is shareable and back-button friendly. Auto-advance timer
 * (1.8s — `AUTO_ADVANCE_DELAY_MS`) lives client-side and is cancelled
 * if the user un-ticks before deadline.
 */
export function CardModal({ csrfToken, workspaceName, projectName, card }: CardModalProps) {
  const router = useRouter();
  const [items, setItems] = useState<readonly ChecklistItemDTO[]>(card.checklist);
  const [_pending, startTransition] = useTransition();

  const close = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('card');
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false });
  }, [router]);

  // Esc → close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Sync local checklist when prop changes (revalidate from server)
  useEffect(() => {
    setItems(card.checklist);
  }, [card.checklist]);

  const allChecked = items.length > 0 && items.every((i) => i.isChecked);

  return (
    <>
      <div className="modal-backdrop" onClick={close} />
      <article className="modal" role="dialog" aria-modal="true" aria-labelledby="card-modal-title">
        <header className="modal-head">
          <div>
            <div className="modal-breadcrumb">
              <span>{workspaceName}</span>
              <span>·</span>
              <span>{projectName}</span>
              <span>·</span>
              <span>#{String(card.shortRef).padStart(3, '0')}</span>
              <span>·</span>
              <strong>{card.columnName}</strong>
            </div>
            <CardTitleInput cardId={card.id} initial={card.title} />
            {card.columnIsBlocked ? (
              <BlockedBanner cardId={card.id} dueDate={card.dueDate} />
            ) : null}
            {allChecked ? <AutoAdvanceBanner cardId={card.id} onComplete={close} /> : null}
          </div>
          <button type="button" className="modal-close" onClick={close} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <section className="modal-section">
            <div className="section-label">Catégorie</div>
            <CategorySelector cardId={card.id} initial={card.categoryTag} />
          </section>

          <section className="modal-section">
            <div className="section-label">Description</div>
            <CardDescriptionInput cardId={card.id} initial={card.description ?? ''} />
          </section>

          <section className="modal-section">
            <div className="section-label">Échéance</div>
            <DueDateInput cardId={card.id} initial={card.dueDate} onAfterUpdate={close} />
          </section>

          <section className="modal-section">
            <div className="checklist-meta">
              <div className="section-label" style={{ marginBottom: 0 }}>
                Checklist
              </div>
              <div className="checklist-count">
                {items.filter((i) => i.isChecked).length} / {items.length}
                {allChecked ? ' ✓' : ''}
              </div>
            </div>
            {items.length > 0 ? (
              <p className="checklist-hint">
                Auto-progression active — la carte avance dès que tout est coché.
              </p>
            ) : null}
            <div className="mt-2">
              {items.map((item) => (
                <CheckRow
                  key={item.id}
                  item={item}
                  onToggle={(isChecked) => {
                    setItems((prev) =>
                      prev.map((i) => (i.id === item.id ? { ...i, isChecked } : i)),
                    );
                    startTransition(async () => {
                      const res = await toggleChecklistItem({
                        itemId: item.id,
                        isChecked,
                      });
                      setItems(res.items);
                    });
                  }}
                  onDelete={() => {
                    startTransition(async () => {
                      const res = await deleteChecklistItem({ itemId: item.id });
                      setItems(res.items);
                    });
                  }}
                />
              ))}
            </div>
            <ChecklistAdder cardId={card.id} onAdd={(updated) => setItems(updated)} />
          </section>

          <section className="modal-section">
            <DeleteCardButton cardId={card.id} csrfToken={csrfToken} onDeleted={close} />
          </section>
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

// ---------- Category selector --------------------------------------------

function CategorySelector({ cardId, initial }: { cardId: string; initial: string | null }) {
  const [active, setActive] = useState<string | null>(initial);

  const pick = (next: string | null) => {
    setActive(next);
    void updateCard({ cardId, categoryTag: next }).catch(() => {
      setActive(initial); // rollback
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => pick(null)}
        aria-pressed={active === null}
        className="rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)] transition hover:border-[color:var(--color-text-main)] hover:text-[color:var(--color-text-main)] aria-pressed:border-[color:var(--color-accent-primary)] aria-pressed:text-[color:var(--color-accent-primary)]"
        style={
          active === null
            ? { borderColor: 'var(--color-accent-primary)', color: 'var(--color-accent-primary)' }
            : undefined
        }
      >
        Aucune
      </button>
      {BUILTIN_CARD_CATEGORIES.map((c) => {
        const isActive = active === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => pick(c.id)}
            aria-pressed={isActive}
            style={{
              outline: isActive ? '2px solid var(--color-accent-primary)' : 'none',
              outlineOffset: 2,
            }}
            className="rounded-full"
          >
            <Tag variant={c.id as BuiltinCardCategoryId} size="sm">
              {c.label}
            </Tag>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Title (debounced save) -----------------------------------------

function CardTitleInput({ cardId, initial }: { cardId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

// ---------- Description ----------------------------------------------------

function CardDescriptionInput({ cardId, initial }: { cardId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <textarea
      rows={4}
      maxLength={8000}
      placeholder="Notes, brief, contraintes…"
      className="description-input"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          void updateCard({ cardId, description: next }).catch(() => {
            // best-effort; the next save will overwrite
          });
        }, 600);
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
      const res = await updateCardDueDate({
        cardId,
        dueDate: next,
      });
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
    <div className="flex items-center gap-3">
      <input
        type="date"
        className="field-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          save(e.target.value || null);
        }}
        disabled={pending}
        style={{ maxWidth: 200 }}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue('');
            save(null);
          }}
          disabled={pending}
          className="text-xs text-[color:var(--color-text-muted)] underline"
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
  onAdd,
}: {
  cardId: string;
  onAdd: (items: readonly ChecklistItemDTO[]) => void;
}) {
  const [title, setTitle] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    startTransition(async () => {
      const res = await createChecklistItem({ cardId, title: trimmed });
      onAdd(res.items);
      setTitle('');
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
        +
      </span>
      <input
        type="text"
        maxLength={200}
        placeholder="Ajouter un élément… (Entrée pour valider)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={pending}
      />
      <button type="submit" disabled={pending || title.trim().length === 0}>
        {pending ? 'Ajout…' : 'Ajouter'}
      </button>
    </form>
  );
}

// ---------- 1.8s auto-advance bandeau -------------------------------------

function AutoAdvanceBanner({ cardId, onComplete }: { cardId: string; onComplete: () => void }) {
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
        ✦ Avancement automatique dans {(remainingMs / 1000).toFixed(1)}s
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

// ---------- Delete -------------------------------------------------------

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
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-[color:var(--color-danger)] underline"
      >
        Supprimer la carte
      </button>
    </form>
  );
}
