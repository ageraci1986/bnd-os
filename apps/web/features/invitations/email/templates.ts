/**
 * Invitation email templates (FR).
 *
 * Plain text + HTML. The HTML uses table-based layout + inline styles
 * (the only thing every email client renders predictably — Gmail strips
 * <style> blocks, Outlook 2013+ ignores most CSS properties).
 *
 * SECURITY: every dynamic value is run through `escapeHtml` before being
 * embedded. The accept URL is the only sensitive payload — it is the
 * single-use token by design.
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

/* ---------- Brand tokens (mirrors mockups/styles.css) -------------------- */
const BRAND_GRADIENT = 'linear-gradient(135deg, #8B2BE2 0%, #FF2A6D 100%)';
const TEXT_MAIN = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_GHOST = '#9CA3AF';
const BG_CANVAS = '#F4F6F9';
const BG_CARD = '#FFFFFF';
const BORDER_LIGHT = '#E5E7EB';
const FONT_STACK =
  '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function renderInvitationEmail(params: InvitationEmailParams): InvitationEmail {
  const { inviterName, workspaceName, acceptUrl, expiresAt } = params;
  const expires = dateFormatterFr.format(expiresAt);

  // Pre-escape every dynamic value once.
  const inviterE = escapeHtml(inviterName);
  const workspaceE = escapeHtml(workspaceName);
  const acceptUrlE = escapeHtml(acceptUrl);
  const expiresE = escapeHtml(expires);

  const subject = `Vous êtes invité à rejoindre ${workspaceName} sur NexusHub`;

  /* ---------- Plain text fallback -------------------------------------- */
  const text = [
    `Bonjour,`,
    ``,
    `${inviterName} vous invite à rejoindre l'espace "${workspaceName}" sur NexusHub.`,
    ``,
    `Pour finaliser votre inscription, ouvrez le lien ci-dessous :`,
    acceptUrl,
    ``,
    `Ce lien est valable jusqu'au ${expires}. Il est à usage unique.`,
    ``,
    `Si vous n'avez pas demandé cette invitation, ignorez ce message.`,
    ``,
    `— L'équipe NexusHub`,
  ].join('\n');

  /* ---------- HTML email ----------------------------------------------- */
  const preheader = `${inviterName} vous invite à rejoindre ${workspaceName} sur NexusHub.`;
  const preheaderE = escapeHtml(preheader);

  const htmlSanitized = `<!doctype html>
<html lang="fr" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
<style>
  /* Limited CSS — most clients honour it; we duplicate critical rules inline below. */
  @media only screen and (max-width: 620px) {
    .nh-container { width: 100% !important; }
    .nh-px { padding-left: 24px !important; padding-right: 24px !important; }
    .nh-h1 { font-size: 28px !important; line-height: 1.2 !important; }
  }
  a { color: #8B2BE2; }
  a:hover { opacity: 0.85; }
</style>
</head>
<body style="margin:0;padding:0;background:${BG_CANVAS};font-family:${FONT_STACK};color:${TEXT_MAIN};-webkit-font-smoothing:antialiased;">
  <!-- Preheader (visible in inbox preview, hidden in body) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BG_CANVAS};opacity:0;">
    ${preheaderE}
  </div>

  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${BG_CANVAS};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" class="nh-container" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${BG_CARD};border-radius:24px;border:1px solid ${BORDER_LIGHT};box-shadow:0 4px 20px rgba(17,24,39,0.04);overflow:hidden;">

          <!-- Top gradient strip -->
          <tr>
            <td style="height:6px;background:${BRAND_GRADIENT};font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Header -->
          <tr>
            <td class="nh-px" style="padding:32px 40px 0 40px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="40" height="40" align="center" style="background:${BRAND_GRADIENT};border-radius:10px;color:#ffffff;font-weight:800;font-size:18px;font-family:${FONT_STACK};line-height:40px;">N</td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <div style="font-weight:800;font-size:16px;letter-spacing:-0.3px;color:${TEXT_MAIN};">NexusHub</div>
                    <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:${TEXT_MUTED};font-weight:600;">Agency OS</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td class="nh-px" style="padding:32px 40px 8px 40px;">
              <h1 class="nh-h1" style="margin:0 0 12px 0;font-family:${FONT_STACK};font-weight:800;font-size:34px;line-height:1.15;letter-spacing:-1px;color:${TEXT_MAIN};">
                Bienvenue dans <span style="background:${BRAND_GRADIENT};-webkit-background-clip:text;background-clip:text;color:transparent;">${workspaceE}</span>
              </h1>
              <p style="margin:0;font-family:${FONT_STACK};font-size:15px;line-height:1.55;color:${TEXT_MUTED};">
                <strong style="color:${TEXT_MAIN};font-weight:700;">${inviterE}</strong> vous invite à rejoindre l'espace de travail
                <strong style="color:${TEXT_MAIN};font-weight:700;">${workspaceE}</strong> sur NexusHub —
                la plateforme qui réunit clients, projets et communications dans un seul endroit.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td class="nh-px" style="padding:28px 40px 8px 40px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="border-radius:999px;background:${BRAND_GRADIENT};box-shadow:0 8px 24px rgba(139,43,226,0.32);">
                    <a href="${acceptUrlE}"
                       style="display:inline-block;padding:14px 32px;font-family:${FONT_STACK};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;mso-padding-alt:14px 32px;">
                      Accepter l'invitation →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Fallback link -->
          <tr>
            <td class="nh-px" style="padding:8px 40px 0 40px;">
              <p style="margin:8px 0 0 0;font-family:${FONT_STACK};font-size:12px;color:${TEXT_MUTED};line-height:1.5;">
                Si le bouton ne s'ouvre pas, copiez-collez ce lien dans votre navigateur :<br>
                <a href="${acceptUrlE}" style="color:#8B2BE2;font-weight:600;word-break:break-all;text-decoration:underline;">${acceptUrlE}</a>
              </p>
            </td>
          </tr>

          <!-- Expiry note -->
          <tr>
            <td class="nh-px" style="padding:24px 40px 0 40px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#FAFBFC;border:1px solid ${BORDER_LIGHT};border-radius:12px;">
                <tr>
                  <td style="padding:14px 18px;font-family:${FONT_STACK};font-size:12px;color:${TEXT_MUTED};line-height:1.55;">
                    <strong style="color:${TEXT_MAIN};font-weight:700;">À noter :</strong> ce lien est valable
                    jusqu'au <span style="color:${TEXT_MAIN};font-weight:600;">${expiresE}</span> et ne peut être
                    utilisé qu'une seule fois.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="nh-px" style="padding:28px 40px 32px 40px;">
              <hr style="border:0;border-top:1px solid ${BORDER_LIGHT};margin:0 0 20px 0;">
              <p style="margin:0;font-family:${FONT_STACK};font-size:11px;line-height:1.6;color:${TEXT_GHOST};">
                Si vous n'avez pas demandé cette invitation, vous pouvez ignorer ce message en toute sécurité —
                aucun compte ne sera créé sans votre intervention.
              </p>
              <p style="margin:14px 0 0 0;font-family:${FONT_STACK};font-size:11px;color:${TEXT_GHOST};">
                — L'équipe NexusHub
              </p>
            </td>
          </tr>

        </table>

        <!-- Outer disclaimer -->
        <table role="presentation" class="nh-container" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin-top:16px;">
          <tr>
            <td class="nh-px" align="center" style="padding:0 40px;font-family:${FONT_STACK};font-size:10px;color:${TEXT_GHOST};line-height:1.6;">
              Cet e-mail a été envoyé automatiquement par NexusHub à la demande de ${inviterE}.<br>
              Pour toute question, répondez directement à ce message.
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, htmlSanitized };
}
