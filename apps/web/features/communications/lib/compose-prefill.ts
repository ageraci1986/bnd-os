import type { ComposeReplyContext } from '@/stores/compose-panel-store';

export type ComposeMode = 'reply' | 'reply_all' | 'forward' | 'new_mail';

export interface ComposePrefill {
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly subject: string;
  readonly bodyHtml: string;
}

interface Args {
  readonly mode: ComposeMode;
  readonly replyTo: ComposeReplyContext | null;
  readonly myEmail: string;
  readonly signatureHtml: string | null;
}

function prefixOnce(prefix: string, subject: string): string {
  if (subject.toLowerCase().startsWith(prefix.toLowerCase())) return subject;
  return `${prefix} ${subject}`;
}

function ccMinusMe(orig: ComposeReplyContext, myEmail: string): string[] {
  const all = new Set<string>();
  for (const a of orig.toRecipients) all.add(a.toLowerCase());
  for (const a of orig.ccRecipients) all.add(a.toLowerCase());
  all.delete(myEmail.toLowerCase());
  all.delete(orig.fromEmail.toLowerCase()); // avoid duplicate with To
  return Array.from(all);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function quoteOriginal(orig: ComposeReplyContext, forward: boolean): string {
  const date = new Date(orig.receivedAt).toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  });
  if (forward) {
    return `<br><br><div>---------- Forwarded message ----------<br>From: ${orig.fromEmail}<br>Date: ${date}<br>Subject: ${orig.subject}<br>To: ${orig.toRecipients.join(', ')}</div><br>${orig.bodyHtmlSanitized ?? `<pre>${escapeHtml(orig.bodyText)}</pre>`}`;
  }
  return `<br><br><div>── Le ${date}, ${orig.fromEmail} a écrit ──</div><blockquote style="border-left:3px solid var(--color-border-light); padding-left:8px; color:var(--color-text-muted)">${orig.bodyHtmlSanitized ?? `<pre>${escapeHtml(orig.bodyText)}</pre>`}</blockquote>`;
}

export function computePrefill(args: Args): ComposePrefill {
  const sig = args.signatureHtml ? `<p><br></p>${args.signatureHtml}` : '<p><br></p>';
  switch (args.mode) {
    case 'reply':
      if (!args.replyTo) return { toRecipients: [], ccRecipients: [], subject: '', bodyHtml: sig };
      return {
        toRecipients: [args.replyTo.fromEmail],
        ccRecipients: [],
        subject: prefixOnce('Re:', args.replyTo.subject),
        bodyHtml: sig + quoteOriginal(args.replyTo, false),
      };
    case 'reply_all':
      if (!args.replyTo) return { toRecipients: [], ccRecipients: [], subject: '', bodyHtml: sig };
      return {
        toRecipients: [args.replyTo.fromEmail],
        ccRecipients: ccMinusMe(args.replyTo, args.myEmail),
        subject: prefixOnce('Re:', args.replyTo.subject),
        bodyHtml: sig + quoteOriginal(args.replyTo, false),
      };
    case 'forward':
      if (!args.replyTo) return { toRecipients: [], ccRecipients: [], subject: '', bodyHtml: sig };
      return {
        toRecipients: [],
        ccRecipients: [],
        subject: prefixOnce('Fwd:', args.replyTo.subject),
        bodyHtml: sig + quoteOriginal(args.replyTo, true),
      };
    case 'new_mail':
      return { toRecipients: [], ccRecipients: [], subject: '', bodyHtml: sig };
  }
}
