/**
 * Invitation email templates (FR + EN).
 *
 * Plain text only. Never inject the recipient name from raw input into HTML
 * — even our `htmlSanitized` flavour escapes everything. The token URL is
 * the only sensitive payload.
 */
import 'server-only';

interface InvitationEmailParams {
  readonly inviterName: string;
  readonly workspaceName: string;
  readonly acceptUrl: string;
  readonly expiresAt: Date;
}

export interface InvitationEmail {
  readonly subject: string;
  readonly text: string;
  readonly htmlSanitized: string;
}

const dateFormatterFr = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderInvitationEmail(params: InvitationEmailParams): InvitationEmail {
  const { inviterName, workspaceName, acceptUrl, expiresAt } = params;
  const expires = dateFormatterFr.format(expiresAt);

  const subject = `Vous êtes invité à rejoindre ${workspaceName} sur NexusHub`;

  const text = [
    `Bonjour,`,
    ``,
    `${inviterName} vous invite à rejoindre l'espace "${workspaceName}" sur NexusHub.`,
    ``,
    `Pour finaliser votre inscription, cliquez sur le lien ci-dessous :`,
    acceptUrl,
    ``,
    `Ce lien est valable jusqu'au ${expires}. Il est à usage unique.`,
    ``,
    `Si vous n'avez pas demandé cette invitation, vous pouvez l'ignorer en toute sécurité.`,
    ``,
    `— L'équipe NexusHub`,
  ].join('\n');

  // Hand-built minimal HTML, every dynamic value escaped.
  const htmlSanitized = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111827;line-height:1.5">
<p>Bonjour,</p>
<p><strong>${escapeHtml(inviterName)}</strong> vous invite à rejoindre l'espace
<strong>${escapeHtml(workspaceName)}</strong> sur NexusHub.</p>
<p style="margin:24px 0">
  <a href="${escapeHtml(acceptUrl)}"
     style="display:inline-block;padding:12px 24px;border-radius:999px;background:linear-gradient(135deg,#8B2BE2,#FF2A6D);color:#fff;text-decoration:none;font-weight:700">
    Accepter l'invitation
  </a>
</p>
<p style="color:#6B7280;font-size:13px">
  Ce lien est valable jusqu'au ${escapeHtml(expires)}. Il est à usage unique.
</p>
<p style="color:#6B7280;font-size:13px">
  Si vous n'avez pas demandé cette invitation, vous pouvez l'ignorer en toute sécurité.
</p>
<p style="margin-top:32px">— L'équipe NexusHub</p>
</body></html>`;

  return { subject, text, htmlSanitized };
}
