import { notify } from '@/features/shell/components/toaster';
import { getCardAttachmentUrl } from '../actions/card-attachments';

/**
 * Téléchargement d'une PJ : URL signée courte avec
 * `Content-Disposition: attachment` (nom d'origine) puis navigation — le
 * navigateur télécharge sans quitter la page.
 */
export async function downloadCardAttachment(attachmentId: string): Promise<void> {
  const res = await getCardAttachmentUrl({ attachmentId, disposition: 'attachment' }).catch(
    () => null,
  );
  if (!res || !res.ok) {
    notify({ tone: 'error', message: res?.message ?? 'Téléchargement impossible. Réessaie.' });
    return;
  }
  window.location.assign(res.url);
}
