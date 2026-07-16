'use client';
import { useState, useTransition } from 'react';
import { fetchAttachmentBinary } from '../actions/fetch-attachment';
import { formatBytes, iconFor, scanStatusLabel } from '../lib/attachment-format';
import type { MailAttachmentDto } from '../lib/mail-dto';
import { notify } from '@/features/shell/components/toaster';

interface Props {
  readonly attachment: MailAttachmentDto;
}

/**
 * A single row in the `MailReader` "Pièces jointes" section (Task 20,
 * Communications iter V1.5). `scanStatus === null` means the binary hasn't
 * been lazily fetched/scanned yet (see EmailAttachment.storagePath doc
 * comment in schema.prisma) — the Télécharger button triggers that fetch on
 * first click. `dirty` / `scan_failed` / `pending` are all non-downloadable:
 * a `pending` row should never occur on the receive path (fetchAttachmentBinary
 * scans synchronously and only ever persists `clean` / `dirty` /
 * `scan_failed`), but the type is shared with the compose-side upload flow
 * (attachment-format.ts), so it's handled defensively rather than assumed
 * unreachable.
 */
export function MailAttachmentRow({ attachment }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isBlocked =
    attachment.scanStatus === 'dirty' ||
    attachment.scanStatus === 'scan_failed' ||
    attachment.scanStatus === 'pending';

  function onDownload() {
    setError(null);
    start(async () => {
      const r = await fetchAttachmentBinary({ attachmentId: attachment.id });
      if (r.ok) {
        const a = document.createElement('a');
        a.href = r.signedUrl;
        a.download = r.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      setError(r.message);
      notify({
        tone: 'error',
        message:
          r.code === 'DIRTY'
            ? `« ${attachment.filename} » a été rejeté par le scan antivirus.`
            : `Échec du téléchargement de « ${attachment.filename} »${r.message ? ` : ${r.message}` : ''}`,
      });
    });
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs">
      <span
        className={`flex-1 truncate ${isBlocked ? 'text-[color:var(--color-text-muted)]' : ''}`}
      >
        <span aria-hidden>{iconFor(attachment.contentType)}</span> {attachment.filename}{' '}
        <span className="text-[color:var(--color-text-muted)]">
          ({formatBytes(attachment.sizeBytes)})
        </span>
      </span>
      {isBlocked ? (
        <span
          className="shrink-0 text-[color:var(--color-danger)]"
          title={scanStatusLabel(attachment.scanStatus)}
        >
          ⚠ {scanStatusLabel(attachment.scanStatus)}
        </span>
      ) : (
        <button
          type="button"
          onClick={onDownload}
          disabled={pending}
          className="btn btn-ghost btn-sm shrink-0"
        >
          {pending ? 'Analyse antivirus…' : 'Télécharger'}
        </button>
      )}
      {error ? (
        <span className="ml-2 shrink-0 text-[color:var(--color-danger)]">{error}</span>
      ) : null}
    </li>
  );
}
