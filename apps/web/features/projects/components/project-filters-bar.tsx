'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BUILTIN_CARD_CATEGORIES } from '@nexushub/domain';
import {
  activeFilterCount,
  parseProjectCardFilter,
  writeProjectCardFilter,
  type DueFilter,
  type ProjectCardFilter,
} from '../lib/card-filter';

export interface FilterColumnOption {
  readonly id: string;
  readonly name: string;
}
export interface FilterMemberOption {
  readonly userId: string;
  readonly displayName: string;
  readonly initials: string;
}
export interface FilterTemplateOption {
  readonly id: string;
  readonly name: string;
}

export interface ProjectFiltersBarProps {
  readonly columns: readonly FilterColumnOption[];
  /** Workspace-defined category labels (string ids). Merged with the
   *  built-ins inside the popover. */
  readonly customCategories: readonly string[];
  readonly members: readonly FilterMemberOption[];
  readonly templates: readonly FilterTemplateOption[];
}

export function ProjectFiltersBar({
  columns,
  customCategories,
  members,
  templates,
}: ProjectFiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const paramsKey = searchParams?.toString() ?? '';

  const filter = useMemo(() => parseProjectCardFilter(new URLSearchParams(paramsKey)), [paramsKey]);
  const count = activeFilterCount(filter);

  const update = (next: ProjectCardFilter) => {
    const merged = writeProjectCardFilter(new URLSearchParams(paramsKey), next);
    const qs = merged.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  const clear = () =>
    update({
      q: '',
      columnIds: [],
      categoryTags: [],
      assigneeIds: [],
      templateIds: [],
      due: { mode: 'all' },
    });

  // Debounced search input — keep router.replace off the keypress hot path.
  const [qLocal, setQLocal] = useState(filter.q);
  useEffect(() => setQLocal(filter.q), [filter.q]);
  useEffect(() => {
    if (qLocal === filter.q) return;
    const t = setTimeout(() => update({ ...filter, q: qLocal }), 220);
    return () => clearTimeout(t);
  }, [qLocal, filter, update]);

  // Popover open/close.
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleId = (
    key: 'columnIds' | 'categoryTags' | 'assigneeIds' | 'templateIds',
    id: string,
  ) => {
    const current = filter[key];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    update({ ...filter, [key]: next });
  };

  const setDue = (mode: DueFilter['mode']) => {
    if (mode === 'all') update({ ...filter, due: { mode: 'all' } });
    else if (mode === 'range') {
      // Default to today..today; the user tweaks the inputs in the popover.
      const today = isoToday();
      update({ ...filter, due: { mode: 'range', from: today, to: today } });
    } else {
      update({ ...filter, due: { mode } });
    }
  };

  const setRange = (from: string, to: string) => {
    if (from && to && from <= to) update({ ...filter, due: { mode: 'range', from, to } });
  };

  return (
    <div className="nx-filters-bar">
      <div className="nx-filters-row">
        <div className="nx-filter-search">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            placeholder="Rechercher (titre, #ref)…"
            value={qLocal}
            onChange={(e) => setQLocal(e.target.value)}
            aria-label="Rechercher dans les cartes"
          />
          {qLocal ? (
            <button
              type="button"
              className="nx-filter-search-clear"
              onClick={() => setQLocal('')}
              aria-label="Effacer la recherche"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 10 10"
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              >
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          ) : null}
        </div>

        <div ref={popRef} className="relative">
          <button
            type="button"
            className={['nx-filter-trigger', open && 'is-open', count > 0 && 'has-active']
              .filter(Boolean)
              .join(' ')}
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <span aria-hidden="true">⊕</span>
            Filtres
            {count > 0 ? <span className="nx-filter-badge">{count}</span> : null}
            <span aria-hidden="true" className="text-[10px] opacity-60">
              ▾
            </span>
          </button>
          {open ? (
            <FilterPopover
              filter={filter}
              columns={columns}
              customCategories={customCategories}
              members={members}
              templates={templates}
              onToggle={toggleId}
              onSetDue={setDue}
              onSetRange={setRange}
              onClear={clear}
            />
          ) : null}
        </div>
      </div>

      {count > 0 ? (
        <ActivePillsBar
          filter={filter}
          columns={columns}
          members={members}
          templates={templates}
          onRemove={(key, id) => toggleId(key, id)}
          onClearText={() => update({ ...filter, q: '' })}
          onClearDue={() => update({ ...filter, due: { mode: 'all' } })}
          onClearAll={clear}
        />
      ) : null}
    </div>
  );
}

// ---------- Popover -------------------------------------------------------

function FilterPopover({
  filter,
  columns,
  customCategories,
  members,
  templates,
  onToggle,
  onSetDue,
  onSetRange,
  onClear,
}: {
  filter: ProjectCardFilter;
  columns: readonly FilterColumnOption[];
  customCategories: readonly string[];
  members: readonly FilterMemberOption[];
  templates: readonly FilterTemplateOption[];
  onToggle: (key: 'columnIds' | 'categoryTags' | 'assigneeIds' | 'templateIds', id: string) => void;
  onSetDue: (mode: DueFilter['mode']) => void;
  onSetRange: (from: string, to: string) => void;
  onClear: () => void;
}) {
  // Built-in + custom categories presented together. Built-ins keep
  // their nice French labels; custom ones use the label itself as the
  // id (matches how Card.categoryTag is stored).
  const allCategories: readonly { id: string; label: string }[] = [
    ...BUILTIN_CARD_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    ...customCategories.map((c) => ({ id: c, label: c })),
  ];

  return (
    <div className="nx-filter-popover" role="dialog" aria-label="Filtres">
      <Section title="Colonne">
        {columns.length === 0 ? (
          <Empty>Aucune colonne.</Empty>
        ) : (
          columns.map((c) => (
            <CheckRow
              key={c.id}
              checked={filter.columnIds.includes(c.id)}
              onChange={() => onToggle('columnIds', c.id)}
              label={c.name}
            />
          ))
        )}
      </Section>

      <Section title="Catégorie">
        {allCategories.length === 0 ? (
          <Empty>Aucune catégorie.</Empty>
        ) : (
          allCategories.map((c) => (
            <CheckRow
              key={c.id}
              checked={filter.categoryTags.includes(c.id)}
              onChange={() => onToggle('categoryTags', c.id)}
              label={c.label}
            />
          ))
        )}
      </Section>

      <Section title="Assignés">
        {members.length === 0 ? (
          <Empty>Aucun membre.</Empty>
        ) : (
          members.map((m) => (
            <CheckRow
              key={m.userId}
              checked={filter.assigneeIds.includes(m.userId)}
              onChange={() => onToggle('assigneeIds', m.userId)}
              label={
                <span className="flex items-center gap-2">
                  <span className="nx-mini-avatar" aria-hidden="true">
                    {m.initials}
                  </span>
                  {m.displayName}
                </span>
              }
            />
          ))
        )}
      </Section>

      <Section title="Template">
        {templates.length === 0 ? (
          <Empty>Aucun template.</Empty>
        ) : (
          templates.map((t) => (
            <CheckRow
              key={t.id}
              checked={filter.templateIds.includes(t.id)}
              onChange={() => onToggle('templateIds', t.id)}
              label={t.name}
            />
          ))
        )}
      </Section>

      <Section title="Échéance">
        <div className="nx-filter-due-row">
          <DueChip current={filter.due.mode} mode="all" label="Toutes" onClick={onSetDue} />
          <DueChip current={filter.due.mode} mode="overdue" label="En retard" onClick={onSetDue} />
          <DueChip current={filter.due.mode} mode="today" label="Aujourd'hui" onClick={onSetDue} />
          <DueChip
            current={filter.due.mode}
            mode="week"
            label="7 prochains jours"
            onClick={onSetDue}
          />
          <DueChip current={filter.due.mode} mode="none" label="Sans échéance" onClick={onSetDue} />
          <DueChip current={filter.due.mode} mode="range" label="Plage…" onClick={onSetDue} />
        </div>
        {filter.due.mode === 'range' ? (
          <div className="nx-filter-due-range">
            <input
              type="date"
              value={filter.due.from}
              max={filter.due.to}
              onChange={(e) =>
                onSetRange(
                  e.target.value,
                  filter.due.mode === 'range' ? filter.due.to : e.target.value,
                )
              }
              aria-label="Du"
            />
            <span aria-hidden="true">→</span>
            <input
              type="date"
              value={filter.due.to}
              min={filter.due.from}
              onChange={(e) =>
                onSetRange(
                  filter.due.mode === 'range' ? filter.due.from : e.target.value,
                  e.target.value,
                )
              }
              aria-label="Au"
            />
          </div>
        ) : null}
      </Section>

      <div className="nx-filter-foot">
        <button type="button" onClick={onClear} className="nx-filter-foot-btn">
          Tout effacer
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="nx-filter-section">
      <div className="nx-filter-section-title">{title}</div>
      <div className="nx-filter-section-body">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="nx-filter-empty">{children}</div>;
}

function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: React.ReactNode;
}) {
  return (
    <label className="nx-filter-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="accent-[color:var(--color-accent-primary)]"
      />
      <span>{label}</span>
    </label>
  );
}

function DueChip({
  current,
  mode,
  label,
  onClick,
}: {
  current: DueFilter['mode'];
  mode: DueFilter['mode'];
  label: string;
  onClick: (mode: DueFilter['mode']) => void;
}) {
  const active = current === mode;
  return (
    <button
      type="button"
      onClick={() => onClick(mode)}
      className={['nx-filter-chip', active && 'is-active'].filter(Boolean).join(' ')}
    >
      {label}
    </button>
  );
}

// ---------- Active pills bar ---------------------------------------------

function ActivePillsBar({
  filter,
  columns,
  members,
  templates,
  onRemove,
  onClearText,
  onClearDue,
  onClearAll,
}: {
  filter: ProjectCardFilter;
  columns: readonly FilterColumnOption[];
  members: readonly FilterMemberOption[];
  templates: readonly FilterTemplateOption[];
  onRemove: (key: 'columnIds' | 'categoryTags' | 'assigneeIds' | 'templateIds', id: string) => void;
  onClearText: () => void;
  onClearDue: () => void;
  onClearAll: () => void;
}) {
  const colName = (id: string) => columns.find((c) => c.id === id)?.name ?? id;
  const memName = (id: string) => members.find((m) => m.userId === id)?.displayName ?? id;
  const tplName = (id: string) => templates.find((t) => t.id === id)?.name ?? id;
  const catLabel = (id: string) => BUILTIN_CARD_CATEGORIES.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="nx-filter-pills">
      {filter.q ? <Pill onRemove={onClearText}>« {filter.q} »</Pill> : null}
      {filter.columnIds.map((id) => (
        <Pill key={`col-${id}`} onRemove={() => onRemove('columnIds', id)}>
          Colonne · {colName(id)}
        </Pill>
      ))}
      {filter.categoryTags.map((id) => (
        <Pill key={`cat-${id}`} onRemove={() => onRemove('categoryTags', id)}>
          Catégorie · {catLabel(id)}
        </Pill>
      ))}
      {filter.assigneeIds.map((id) => (
        <Pill key={`asg-${id}`} onRemove={() => onRemove('assigneeIds', id)}>
          Assigné · {memName(id)}
        </Pill>
      ))}
      {filter.templateIds.map((id) => (
        <Pill key={`tpl-${id}`} onRemove={() => onRemove('templateIds', id)}>
          Template · {tplName(id)}
        </Pill>
      ))}
      {filter.due.mode !== 'all' ? <Pill onRemove={onClearDue}>{dueLabel(filter.due)}</Pill> : null}

      <button type="button" onClick={onClearAll} className="nx-filter-pills-clear">
        Tout effacer
      </button>
    </div>
  );
}

function Pill({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="nx-filter-pill">
      <span>{children}</span>
      <button type="button" onClick={onRemove} aria-label="Retirer ce filtre">
        <svg
          aria-hidden="true"
          viewBox="0 0 10 10"
          width="9"
          height="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <line x1="2" y1="2" x2="8" y2="8" />
          <line x1="8" y1="2" x2="2" y2="8" />
        </svg>
      </button>
    </span>
  );
}

function dueLabel(d: DueFilter): string {
  if (d.mode === 'today') return 'Échéance · Aujourd’hui';
  if (d.mode === 'week') return 'Échéance · 7 prochains jours';
  if (d.mode === 'overdue') return 'Échéance · En retard';
  if (d.mode === 'none') return 'Échéance · Sans échéance';
  if (d.mode === 'range') return `Échéance · ${d.from} → ${d.to}`;
  return 'Échéance';
}

function isoToday(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}
