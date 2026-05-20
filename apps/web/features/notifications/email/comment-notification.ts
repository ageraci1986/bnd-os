/**
 * Card-comment email notification.
 *
 * Visual language mirrors the invitation email (table-based layout,
 * inline styles, brand gradient) so users get a consistent NexusHub
 * inbox treatment.
 *
 * SECURITY: every dynamic value passes through `escapeHtml` before
 * being embedded. The comment preview is *plain text* (not markdown
 * HTML) — clients render HTML in unpredictable ways and stripping
 * markdown keeps the email predictable and safer.
 */
import 'server-only';

interface CommentEmailParams {
  readonly recipientFirstName: string;
  readonly authorDisplayName: string;
  readonly cardShortRef: number;
  readonly cardTitle: string;
  readonly projectName: string;
  readonly clientName: string;
  /** Already plain-text, already truncated to ~200 chars. */
  readonly commentBodyPreview: string;
  readonly commentUrl: string;
}

export interface CommentEmail {
  readonly subject: string;
  readonly text: string;
  readonly htmlSanitized: string;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const BRAND_GRADIENT = 'linear-gradient(135deg, #8B2BE2 0%, #FF2A6D 100%)';
const TEXT_MAIN = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_GHOST = '#9CA3AF';
const BG_CANVAS = '#F4F6F9';
const BG_CARD = '#FFFFFF';
const BORDER_LIGHT = '#E5E7EB';
const FONT_STACK =
  '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function renderCommentNotificationEmail(params: CommentEmailParams): CommentEmail {
  const {
    recipientFirstName,
    authorDisplayName,
    cardShortRef,
    cardTitle,
    projectName,
    clientName,
    commentBodyPreview,
    commentUrl,
  } = params;

  const subject = `[NexusHub] ${authorDisplayName} a commenté « ${cardTitle} »`;

  const text = [
    `Salut ${recipientFirstName},`,
    ``,
    `${authorDisplayName} vient de commenter la carte #${cardShortRef} · ${cardTitle} dans le projet ${projectName} (${clientName}).`,
    ``,
    `> ${commentBodyPreview}`,
    ``,
    `Voir le commentaire :`,
    commentUrl,
    ``,
    `Tu reçois cet email parce que tu es assigné à cette carte.`,
    `— L'équipe NexusHub`,
  ].join('\n');

  const recipientE = escapeHtml(recipientFirstName);
  const authorE = escapeHtml(authorDisplayName);
  const cardTitleE = escapeHtml(cardTitle);
  const projectE = escapeHtml(projectName);
  const clientE = escapeHtml(clientName);
  const previewE = escapeHtml(commentBodyPreview);
  const urlE = escapeHtml(commentUrl);
  const subjectE = escapeHtml(subject);

  const htmlSanitized = `<!doctype html>
<html lang="fr" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subjectE}</title>
</head>
<body style="margin:0;padding:0;background:${BG_CANVAS};font-family:${FONT_STACK};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${BG_CANVAS};padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${BG_CARD};border:1px solid ${BORDER_LIGHT};border-radius:16px;">
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="40" height="40" align="center" style="background:${BRAND_GRADIENT};border-radius:10px;color:#ffffff;font-weight:800;font-size:18px;font-family:${FONT_STACK};line-height:40px;">N</td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <div style="font-weight:800;font-size:16px;color:${TEXT_MAIN};">NexusHub</div>
                    <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:${TEXT_MUTED};font-weight:600;">Agency OS</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <h1 style="margin:0 0 8px 0;font-family:${FONT_STACK};font-weight:800;font-size:22px;line-height:1.25;color:${TEXT_MAIN};">
                Salut ${recipientE},
              </h1>
              <p style="margin:0;font-family:${FONT_STACK};font-size:14px;line-height:1.6;color:${TEXT_MUTED};">
                <strong style="color:${TEXT_MAIN};font-weight:700;">${authorE}</strong> vient de commenter la carte
                <strong style="color:${TEXT_MAIN};font-weight:700;">#${cardShortRef} · ${cardTitleE}</strong>
                dans le projet <strong style="color:${TEXT_MAIN};font-weight:700;">${projectE}</strong> (${clientE}).
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#FAFBFC;border-left:3px solid #8B2BE2;border-radius:6px;">
                <tr>
                  <td style="padding:14px 18px;font-family:${FONT_STACK};font-size:14px;color:${TEXT_MAIN};line-height:1.55;white-space:pre-wrap;">${previewE}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="border-radius:999px;background:${BRAND_GRADIENT};box-shadow:0 8px 24px rgba(139,43,226,0.32);">
                    <a href="${urlE}" style="display:inline-block;padding:12px 28px;font-family:${FONT_STACK};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">Voir le commentaire →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 28px 32px;">
              <hr style="border:0;border-top:1px solid ${BORDER_LIGHT};margin:0 0 16px 0;">
              <p style="margin:0;font-family:${FONT_STACK};font-size:11px;line-height:1.6;color:${TEXT_GHOST};">
                Tu reçois cet email parce que tu es assigné à cette carte.<br>
                — L'équipe NexusHub
              </p>
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
