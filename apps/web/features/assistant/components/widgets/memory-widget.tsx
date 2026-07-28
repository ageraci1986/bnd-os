import { z } from 'zod';
import { parseWidgetData } from './parse-widget-data';

/**
 * Shapes produites par les trois tools mémoire (memory-tools.ts). Union
 * discriminée par la clé littérale (`remembered`/`updated`/`forgotten`) —
 * un seul schéma pour les trois tools, extras tolérés.
 */
const MemoryEventSchema = z.union([
  z.object({ remembered: z.literal(true), name: z.string(), fact: z.string() }),
  z.object({ updated: z.literal(true), name: z.string(), fact: z.string() }),
  z.object({ forgotten: z.literal(true), name: z.string() }),
]);

type MemoryEvent = z.infer<typeof MemoryEventSchema>;

function label(event: MemoryEvent): string {
  if ('remembered' in event) return `retenu « ${event.fact} »`;
  if ('updated' in event) return `mis à jour « ${event.fact} »`;
  return `oublié (${event.name})`;
}

export interface MemoryWidgetProps {
  /** Nom du tool d'origine — uniquement pour l'étiquette du warn de parse. */
  readonly tool: string;
  readonly data: unknown;
}

/**
 * Chip compact mono-ligne rendu à CHAQUE écriture mémoire de l'agent
 * (remember/update/forget) : visibilité déterministe — le chip apparaît
 * quoi que raconte le modèle dans son texte, un fait ne peut pas être
 * planté silencieusement. Le fait affiché vient de la sortie du tool
 * (version normalisée réellement stockée), pas du texte du modèle.
 */
export function MemoryWidget({ tool, data }: MemoryWidgetProps) {
  const event = parseWidgetData(tool, MemoryEventSchema, data);
  if (event === null) return null;

  return (
    <p className="inline-flex max-w-full items-baseline gap-1.5 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-3 py-1 text-xs text-[color:var(--color-text-muted)]">
      <span aria-hidden="true">🧠</span>
      <span className="truncate">
        <span className="font-bold text-[color:var(--color-text-main)]">Mémoire :</span>{' '}
        {label(event)}
      </span>
    </p>
  );
}
