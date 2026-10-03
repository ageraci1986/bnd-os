/**
 * Pièces jointes de cartes (spec lot C §2). Pur TS — liste blanche
 * extension + MIME, assainissement du nom, contrôle magic bytes.
 */
export const CARD_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const CARD_ATTACHMENT_MAX_PER_CARD = 50;

export type AttachmentKind = 'image' | 'video' | 'pdf' | 'file';

interface AllowedType {
  readonly ext: readonly string[];
  readonly mime: string;
}

const OOXML = 'application/vnd.openxmlformats-officedocument';

export const ALLOWED_CARD_ATTACHMENT_TYPES: readonly AllowedType[] = [
  { ext: ['jpg', 'jpeg'], mime: 'image/jpeg' },
  { ext: ['png'], mime: 'image/png' },
  { ext: ['gif'], mime: 'image/gif' },
  { ext: ['webp'], mime: 'image/webp' },
  { ext: ['heic'], mime: 'image/heic' },
  { ext: ['mp4'], mime: 'video/mp4' },
  { ext: ['mov'], mime: 'video/quicktime' },
  { ext: ['webm'], mime: 'video/webm' },
  { ext: ['pdf'], mime: 'application/pdf' },
  { ext: ['docx'], mime: `${OOXML}.wordprocessingml.document` },
  { ext: ['xlsx'], mime: `${OOXML}.spreadsheetml.sheet` },
  { ext: ['pptx'], mime: `${OOXML}.presentationml.presentation` },
  { ext: ['txt'], mime: 'text/plain' },
  { ext: ['csv'], mime: 'text/csv' },
  { ext: ['zip'], mime: 'application/zip' },
];

/** Accept attribute pour `<input type="file">`. */
export const CARD_ATTACHMENT_ACCEPT = ALLOWED_CARD_ATTACHMENT_TYPES.flatMap((t) =>
  t.ext.map((e) => `.${e}`),
).join(',');

export function sanitizeAttachmentFilename(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f/\\]/g, '')
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : 'fichier';
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot <= 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

export function isAllowedAttachment(filename: string, contentType: string): boolean {
  const ext = extensionOf(filename);
  const mime = contentType.toLowerCase();
  return ALLOWED_CARD_ATTACHMENT_TYPES.some((t) => t.mime === mime && t.ext.includes(ext));
}

/** Images que la plupart des navigateurs ne savent pas afficher (hors Safari). */
const NON_PREVIEWABLE_IMAGES = new Set(['image/heic', 'image/heif']);

export function attachmentKind(contentType: string): AttachmentKind {
  const mime = contentType.toLowerCase();
  // HEIC/HEIF : pas de miniature cassée — traité comme un fichier téléchargeable.
  if (NON_PREVIEWABLE_IMAGES.has(mime)) return 'file';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

const TEXT_TYPES = new Set(['text/plain', 'text/csv']);

/**
 * Alias de détection (`file-type`) → type déclaré de la liste blanche. Sens
 * unique : un alias ne valide QUE son type déclaré cible.
 *   - HEIF est le conteneur générique de HEIC (même brand ISO-BMFF) ;
 *   - `video/x-m4v` est un MP4 Apple (brand `M4V `).
 */
const SNIFF_ALIASES: Readonly<Record<string, string>> = {
  'image/heif': 'image/heic',
  'video/x-m4v': 'video/mp4',
};

/**
 * `sniffed` = MIME détecté par magic bytes (`file-type`), `undefined` si non
 * détectable. Les formats texte ne sont pas détectables → acceptés ; tout
 * autre format non détectable est refusé (fail-closed).
 */
export function isSniffCompatible(declared: string, sniffed: string | undefined): boolean {
  const d = declared.toLowerCase();
  if (sniffed === undefined) return TEXT_TYPES.has(d);
  const s = sniffed.toLowerCase();
  if (s === d) return true;
  if (SNIFF_ALIASES[s] === d) return true;
  if (d.startsWith(`${OOXML}.`) && s === 'application/zip') return true;
  return false;
}
