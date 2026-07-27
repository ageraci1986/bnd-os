import { z } from 'zod';
import Link from 'next/link';
import { formatDue } from './format-date';
import { parseWidgetData } from './parse-widget-data';

/** Nb max de cartes affichées par colonne avant le résumé « +N autres ». */
const CARDS_SHOWN_PER_COLUMN = 5;

/** Shape produite par le tool `get_project_board` (read-tools.ts). Extras tolérés. */
const BoardCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  due: z.string().nullable(),
});

const BoardColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  blocked: z.boolean(),
  cards: z.array(BoardCardSchema),
  truncated: z.boolean().optional(),
});

const ProjectBoardSchema = z.object({
  id: z.string(),
  name: z.string(),
  columns: z.array(BoardColumnSchema),
});

export interface BoardWidgetProps {
  readonly data: unknown;
}

/** Mini-Kanban pour `get_project_board` : colonnes en flex horizontal scrollable. */
export function BoardWidget({ data }: BoardWidgetProps) {
  const board = parseWidgetData('get_project_board', ProjectBoardSchema, data);
  if (board === null) return null;

  return (
    <div className="w-full rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-4">
      <Link
        href={`/projects/${board.id}`}
        className="text-sm font-bold text-[color:var(--color-text-main)] hover:underline"
      >
        {board.name}
      </Link>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
        {board.columns.map((column) => {
          const shown = column.cards.slice(0, CARDS_SHOWN_PER_COLUMN);
          const extra = column.cards.length - shown.length;
          return (
            <div
              key={column.id}
              className="w-44 shrink-0 rounded-xl border border-[color:var(--color-border-soft)] p-2"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-xs font-bold text-[color:var(--color-text-main)]">
                  {column.name}
                </span>
                <span className="shrink-0 text-[10px] font-semibold text-[color:var(--color-text-muted)]">
                  {column.cards.length}
                </span>
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {shown.map((card) => (
                  <li key={card.id} className="rounded-lg bg-[color:var(--color-bg-hover)] p-1.5">
                    <p className="truncate text-xs text-[color:var(--color-text-soft)]">
                      {card.title}
                    </p>
                    {card.due !== null && (
                      <p
                        className="mt-0.5 text-[10px] font-semibold"
                        style={
                          column.blocked
                            ? { color: 'var(--color-danger)' }
                            : { color: 'var(--color-text-ghost)' }
                        }
                      >
                        {formatDue(card.due)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {extra > 0 && (
                <p className="mt-1 text-[10px] font-semibold text-[color:var(--color-text-ghost)]">
                  +{extra} autres{column.truncated === true ? ' (liste partielle)' : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
