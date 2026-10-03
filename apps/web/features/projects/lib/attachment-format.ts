import { ALLOWED_CARD_ATTACHMENT_TYPES, isAllowedAttachment } from '@nexushub/domain';

/**
 * MIME que certains navigateurs/OS posent à la place du MIME canonique
 * (fichier sans type connu, CSV Windows, ZIP Windows). Dans ces cas seulement,
 * on déduit le MIME de l'extension ; le serveur revalide (liste blanche) et le
 * scan contrôle les magic bytes — aucune confiance supplémentaire accordée.
 */
const GENERIC_BROWSER_TYPES = new Set([
  '',
  'application/octet-stream',
  'application/vnd.ms-excel',
  'application/x-zip-compressed',
]);

/** MIME à déclarer pour ce fichier, ou null s'il n'est pas autorisé. */
export function resolveUploadContentType(file: { name: string; type: string }): string | null {
  const declared = file.type.toLowerCase();
  if (isAllowedAttachment(file.name, declared)) return declared;
  if (!GENERIC_BROWSER_TYPES.has(declared)) return null;
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const match = ALLOWED_CARD_ATTACHMENT_TYPES.find((t) => t.ext.includes(ext));
  return match && isAllowedAttachment(file.name, match.mime) ? match.mime : null;
}

const numberFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${numberFr.format(bytes / (1024 * 1024))} Mo`;
}

const dateFr = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatAttachmentDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFr.format(d);
}
