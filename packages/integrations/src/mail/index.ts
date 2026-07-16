export type { ParsedMailMessage, ParsedMailAttachmentMeta } from './types';
export { sanitizeMailHtml, stripMailHtmlToText } from './sanitize';
export { autodiscoverMail } from './autodiscover';
export type { MailServerConfig, AutodiscoverMailResult } from './autodiscover';
