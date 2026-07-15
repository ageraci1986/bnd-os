import type { MailDTO } from '../lib/mail-dto';

function initials(name: string | null, email: string): string {
  const src = name ?? email;
  const parts = src.split(/[\s.@]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '');
}

export function MailReader({ mail }: { readonly mail: MailDTO | null }) {
  if (!mail) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-[color:var(--color-text-muted)]">
        Sélectionne un mail à gauche.
      </div>
    );
  }
  return (
    <div className="overflow-y-auto bg-[color:var(--color-bg-card)] p-7">
      <h2 className="mb-3 text-lg font-extrabold text-[color:var(--color-text-main)]">
        {mail.subject || '(sans sujet)'}
      </h2>
      <div className="mb-5 flex items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {initials(mail.fromName, mail.fromEmail)}
        </span>
        <div className="leading-tight">
          <div className="text-sm font-bold text-[color:var(--color-text-main)]">
            {mail.fromName ?? mail.fromEmail}
            {mail.client ? (
              <span
                className="ml-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--color-bg-muted)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
                style={{ color: `var(--${mail.client.colorToken})` }}
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: `var(--${mail.client.colorToken})` }}
                />
                {mail.client.name}
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-[color:var(--color-text-muted)]">{mail.fromEmail}</div>
          <div className="text-[11px] text-[color:var(--color-text-muted)]">
            {new Date(mail.receivedAt).toLocaleString('fr-FR', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
            {mail.toRecipients.length > 0 ? ` — à ${mail.toRecipients.join(', ')}` : ''}
          </div>
        </div>
      </div>
      {mail.bodyHtmlSanitized ? (
        <div
          className="text-sm leading-relaxed text-[color:var(--color-text-soft)]"
          dangerouslySetInnerHTML={{ __html: mail.bodyHtmlSanitized }}
        />
      ) : (
        <pre className="whitespace-pre-wrap font-sans text-sm text-[color:var(--color-text-soft)]">
          {mail.bodyText}
        </pre>
      )}
      <div className="mt-6 rounded-lg border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] px-4 py-3 text-center text-xs text-[color:var(--color-text-muted)]">
        ↩ Répondre — bientôt (itération 2)
      </div>
    </div>
  );
}
