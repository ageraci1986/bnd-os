/**
 * attachment-format — shared display helpers for mail attachments
 * (Communications iter V1.5, Task 18). Pure functions, no DOM/React deps —
 * consumed by `AttachmentDrop` (Task 18) and by Task 20's MailReader
 * attachment row / MailList 📎 badge, so the exports here are the shared
 * contract between both.
 *
 * Unit formatting deliberately matches the mockup in
 * docs/superpowers/specs/2026-07-16-mail-attachments-design.md (§ compose
 * panel wireframe: "📎 Pièces jointes (2 · 4.3 MB / 25 MB)") — period
 * decimal separator with "B/KB/MB" units, not the comma-decimal "Ko/Mo"
 * Intl.NumberFormat('fr-FR') would otherwise produce. All other UI copy in
 * this feature is hardcoded French (no next-intl usage anywhere under
 * features/communications/ yet — see compose-panel.tsx) — this file follows
 * that established convention rather than introducing next-intl here alone.
 */

/** Formats a byte count as "512 B" / "4.3 KB" / "1.2 MB", matching the design mockup. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Buckets a MIME type into a small emoji glyph. No icon library
 * (lucide-react et al.) is installed in this project yet and no other
 * component under features/communications/ uses one — introducing a new
 * dependency for a handful of glyphs isn't warranted (CLAUDE.md §2 requires
 * a Context7-checked install for any new package, which isn't justified
 * here). Emoji keeps this a pure, dependency-free, directly testable
 * function; a real icon can replace these later without changing the call
 * sites (Task 20's MailAttachmentRow calls this the same way).
 */
export function iconFor(contentType: string): string {
  const type = contentType.toLowerCase();
  if (type.startsWith('image/')) return '🖼';
  if (type === 'application/pdf') return '📄';
  if (type.includes('sheet') || type.includes('excel')) return '📊';
  if (type.includes('presentation') || type.includes('powerpoint')) return '📈';
  if (type.includes('word') || type === 'text/plain') return '📝';
  if (type.includes('zip') || type.includes('compress') || type.includes('archive')) return '📦';
  return '📎';
}

/** Attachment scan status, mirrors `MailAttachmentDto['scanStatus']` (Task 20). */
export type AttachmentScanStatus = 'pending' | 'clean' | 'dirty' | 'scan_failed' | null;

/** French UI copy for a persisted attachment's scan status (Task 20's MailReader row). */
export function scanStatusLabel(status: AttachmentScanStatus): string {
  switch (status) {
    case 'pending':
      return "En cours d'analyse…";
    case 'clean':
      return 'Prêt';
    case 'scan_failed':
      return 'Analyse échouée';
    case 'dirty':
      return 'Fichier bloqué (menace détectée)';
    case null:
      return '';
    default: {
      // Exhaustiveness guard — AttachmentScanStatus is a closed union.
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
