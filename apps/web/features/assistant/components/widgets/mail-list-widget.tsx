import { z } from 'zod';
import Link from 'next/link';
import { formatReceivedAt } from './format-date';
import { parseWidgetData } from './parse-widget-data';

/** Nb max de mails affichés (au-delà, la liste est déjà bornée par le tool). */
const MAILS_SHOWN_MAX = 10;

/** Shape produite par le tool `search_mails` (read-tools.ts). Extras tolérés. */
const MailRowSchema = z.object({
  id: z.string(),
  subject: z.string().nullable(),
  fromEmail: z.string(),
  fromName: z.string().nullable(),
  receivedAt: z.string(),
  isRead: z.boolean(),
  folder: z.string(),
  // Optionnel : tolérant aux données produites par un tour antérieur à
  // l'ajout d'`integrationId` côté search_mails (Plan 5c Task 3). Utilisé par
  // le rendu interactif du widget (Task 4) pour le deep-link
  // `?mailbox=<integrationId>&mail=<id>` — pas encore consommé ici.
  integrationId: z.string().optional(),
});

const MailListSchema = z.array(MailRowSchema);

export interface MailListWidgetProps {
  readonly data: unknown;
}

/** Liste de mails pour `search_mails` — lignes expéditeur / objet / date / pastille non-lu. */
export function MailListWidget({ data }: MailListWidgetProps) {
  const parsed = parseWidgetData('search_mails', MailListSchema, data);
  // Liste vide : rien à montrer — le texte du modèle explique déjà l'absence
  // de résultats, un cadre vide n'apporterait que du bruit.
  if (parsed === null || parsed.length === 0) return null;
  const mails = parsed.slice(0, MAILS_SHOWN_MAX);

  return (
    <div className="w-full rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3">
      <ul className="flex flex-col divide-y divide-[color:var(--color-border-soft)]">
        {mails.map((mail) => (
          <li key={mail.id}>
            <Link
              href="/communications"
              className="flex items-center gap-2 py-2 no-underline hover:bg-[color:var(--color-bg-hover)]"
            >
              {!mail.isRead && (
                <span
                  aria-label="non lu"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: 'var(--accent-primary)' }}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-[color:var(--color-text-main)]">
                  {mail.fromName ?? mail.fromEmail}
                </p>
                <p className="truncate text-xs text-[color:var(--color-text-muted)]">
                  {mail.subject ?? '(sans objet)'}
                </p>
              </div>
              <span className="shrink-0 text-[10px] text-[color:var(--color-text-ghost)]">
                {formatReceivedAt(mail.receivedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
