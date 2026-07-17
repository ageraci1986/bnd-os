import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// Vitest hoists vi.mock above all imports, so anything a factory closes
// over must come from `vi.hoisted()` — mirrors the pattern used across
// this feature's other tests (see mail-drafts.test.ts, load-forward-
// attachments.test.ts).
const {
  notifySpy,
  saveDraftSpy,
  loadDraftSpy,
  deleteDraftSpy,
  sendMailSpy,
  loadForwardAttachmentsSpy,
  removeAttachmentFromDraftSpy,
} = vi.hoisted(() => ({
  notifySpy: vi.fn(),
  saveDraftSpy: vi.fn(),
  loadDraftSpy: vi.fn(),
  deleteDraftSpy: vi.fn(),
  sendMailSpy: vi.fn(),
  loadForwardAttachmentsSpy: vi.fn(),
  removeAttachmentFromDraftSpy: vi.fn(),
}));

vi.mock('@/features/shell/components/toaster', () => ({
  notify: (...a: unknown[]) => notifySpy(...a),
}));

vi.mock('../actions/mail-drafts', () => ({
  saveDraft: (...a: unknown[]) => saveDraftSpy(...a),
  loadDraft: (...a: unknown[]) => loadDraftSpy(...a),
  deleteDraft: (...a: unknown[]) => deleteDraftSpy(...a),
}));

vi.mock('../actions/send-mail', () => ({
  sendMail: (...a: unknown[]) => sendMailSpy(...a),
}));

vi.mock('../actions/load-forward-attachments', () => ({
  loadForwardAttachments: (...a: unknown[]) => loadForwardAttachmentsSpy(...a),
}));

vi.mock('../actions/remove-attachment-from-draft', () => ({
  removeAttachmentFromDraft: (...a: unknown[]) => removeAttachmentFromDraftSpy(...a),
}));

// Tiptap/ProseMirror needs DOM APIs jsdom doesn't fully implement
// (getClientRects, Range internals) — no existing test exercises it
// directly. Stub it: ComposePanel wiring under test doesn't depend on the
// rich text editor's internals, only on `bodyHtml` state (untouched here).
vi.mock('./rich-text-editor', () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor-stub" />,
}));

// AddMailboxModal transitively imports several 'use server' action files
// (Graph OAuth, IMAP autodiscovery...) that pull in real integration
// clients — out of scope for this test and never actually rendered here
// (showConfigModal never flips true in these scenarios).
vi.mock('@/features/integrations/components/add-mailbox-modal', () => ({
  AddMailboxModal: () => null,
}));

// Real hook, but re-implemented with actual React state so `setInitial` /
// `addFiles` / `removeItem` calls are observable through re-renders (the
// same contract as ../hooks/use-attachment-uploader.ts) — the real hook's
// own upload machinery (ClamAV scan round-trip via `uploadAttachment`) is
// already covered by use-attachment-uploader.test.ts; this test is only
// about ComposePanel's wiring against that contract.
vi.mock('../hooks/use-attachment-uploader', () => {
  const setInitialSpy = vi.fn();
  const addFilesSpy = vi.fn();
  const removeItemSpy = vi.fn();
  return {
    MAX_ATTACHMENTS: 20,
    MAX_FILE_BYTES: 25 * 1024 * 1024,
    __spies: { setInitialSpy, addFilesSpy, removeItemSpy },
    useAttachmentUploader: () => {
      const [items, setItems] = React.useState<
        {
          id: string;
          filename: string;
          contentType: string;
          sizeBytes: number;
          storagePath: string;
          sha256: string;
          state: 'uploading' | 'clean' | 'dirty' | 'error';
          error?: string;
        }[]
      >([]);
      const setInitial = React.useCallback((next: typeof items) => {
        setInitialSpy(next);
        setItems(next);
      }, []);
      const addFiles = React.useCallback(async (files: readonly File[]) => {
        addFilesSpy(files);
        const added = files.map((f, i) => ({
          id: `up-${f.name}-${i}`,
          filename: f.name,
          contentType: f.type || 'application/octet-stream',
          sizeBytes: f.size,
          storagePath: `w/up-${f.name}`,
          sha256: 'a'.repeat(64),
          state: 'clean' as const,
        }));
        setItems((prev) => [...prev, ...added]);
        return { accepted: added.length, capRejected: 0, oversizeRejected: 0 };
      }, []);
      const removeItem = React.useCallback((id: string) => {
        removeItemSpy(id);
        setItems((prev) => prev.filter((x) => x.id !== id));
      }, []);
      const totalBytes = items.reduce((sum, x) => sum + x.sizeBytes, 0);
      return { items, addFiles, removeItem, clearAll: vi.fn(), setInitial, totalBytes };
    },
  };
});

import { ComposePanel, type MailboxOption } from './compose-panel';
import { useComposePanelStore } from '@/stores/compose-panel-store';

const mailboxes: readonly MailboxOption[] = [
  { integrationId: 'int-1', externalAccountId: 'me@example.com', signatureHtml: null },
];

const draftAttachment = {
  id: '00000000-0000-0000-0000-0000000000a1',
  filename: 'brief.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1024,
  storagePath: 'w/00000000-0000-0000-0000-0000000000a1',
  sha256: 'a'.repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  loadDraftSpy.mockResolvedValue({ ok: true, draft: null });
  saveDraftSpy.mockResolvedValue({ ok: true, id: 'draft-1' });
  loadForwardAttachmentsSpy.mockResolvedValue({ ok: true, added: [], skipped: [] });
  useComposePanelStore.setState({
    isOpen: false,
    minimized: false,
    mode: 'new_mail',
    replyTo: null,
  });
});

afterEach(() => {
  useComposePanelStore.setState({
    isOpen: false,
    minimized: false,
    mode: 'new_mail',
    replyTo: null,
  });
});

describe('<ComposePanel /> — attachments wiring (Task 19)', () => {
  it('seeds the uploader from the loaded draft composeAttachments', async () => {
    loadDraftSpy.mockResolvedValueOnce({
      ok: true,
      draft: {
        id: 'draft-1',
        fromIntegrationId: 'int-1',
        kind: 'new_mail',
        replyToId: null,
        toRecipients: [],
        ccRecipients: [],
        bccRecipients: [],
        subject: 'Hello',
        bodyHtml: '<p>Hi</p>',
        composeAttachments: [draftAttachment],
        updatedAt: new Date().toISOString(),
      },
    });
    useComposePanelStore.setState({
      isOpen: true,
      minimized: false,
      mode: 'new_mail',
      replyTo: null,
    });

    render(<ComposePanel mailboxes={mailboxes} />);

    await waitFor(() => expect(screen.getByText(/brief\.pdf/)).toBeInTheDocument());
    expect(loadForwardAttachmentsSpy).not.toHaveBeenCalled();
  });

  it('triggers loadForwardAttachments exactly once when opened in forward mode with no existing draft', async () => {
    useComposePanelStore.setState({
      isOpen: true,
      minimized: false,
      mode: 'forward',
      replyTo: {
        id: 'msg-1',
        externalId: 'ext-1',
        subject: 'Original',
        fromEmail: 'them@example.com',
        toRecipients: ['me@example.com'],
        ccRecipients: [],
        bodyText: 'body',
        bodyHtmlSanitized: '<p>body</p>',
        receivedAt: new Date().toISOString(),
        integrationId: 'int-1',
      },
    });
    loadForwardAttachmentsSpy.mockResolvedValueOnce({
      ok: true,
      added: [{ ...draftAttachment, reprisedFromAttachmentId: 'src-1' }],
      skipped: [],
    });

    render(<ComposePanel mailboxes={mailboxes} />);

    await waitFor(() => expect(loadForwardAttachmentsSpy).toHaveBeenCalledTimes(1));
    expect(loadForwardAttachmentsSpy).toHaveBeenCalledWith({
      emailMessageId: 'msg-1',
      draftId: 'draft-1',
    });
    await waitFor(() => expect(screen.getByText(/brief\.pdf/)).toBeInTheDocument());
  });

  it('persists newly added attachments to the draft after the autosave debounce', async () => {
    vi.useFakeTimers();
    useComposePanelStore.setState({
      isOpen: true,
      minimized: false,
      mode: 'new_mail',
      replyTo: null,
    });
    render(<ComposePanel mailboxes={mailboxes} />);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync(); // flush the loadDraft microtask chain
    });
    saveDraftSpy.mockClear();

    const input = screen.getByLabelText('Ajouter des pièces jointes') as HTMLInputElement;
    const file = new File(['x'], 'contract.pdf', { type: 'application/pdf' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(saveDraftSpy).toHaveBeenCalled();
    const lastCall = saveDraftSpy.mock.calls.at(-1)?.[0];
    expect(lastCall.composeAttachments).toEqual([
      expect.objectContaining({ filename: 'contract.pdf' }),
    ]);
    vi.useRealTimers();
  });

  it('onRemove calls removeAttachmentFromDraft and removes the item locally', async () => {
    loadDraftSpy.mockResolvedValueOnce({
      ok: true,
      draft: {
        id: 'draft-1',
        fromIntegrationId: 'int-1',
        kind: 'new_mail',
        replyToId: null,
        toRecipients: [],
        ccRecipients: [],
        bccRecipients: [],
        subject: '',
        bodyHtml: '',
        composeAttachments: [draftAttachment],
        updatedAt: new Date().toISOString(),
      },
    });
    useComposePanelStore.setState({
      isOpen: true,
      minimized: false,
      mode: 'new_mail',
      replyTo: null,
    });
    render(<ComposePanel mailboxes={mailboxes} />);

    await waitFor(() => expect(screen.getByText(/brief\.pdf/)).toBeInTheDocument());
    const removeBtn = screen.getByRole('button', { name: `Retirer ${draftAttachment.filename}` });
    await act(async () => {
      removeBtn.click();
    });

    expect(removeAttachmentFromDraftSpy).toHaveBeenCalledWith({
      attachmentDraftId: draftAttachment.id,
    });
    await waitFor(() => expect(screen.queryByText(/brief\.pdf/)).not.toBeInTheDocument());
  });
});

describe('<ComposePanel /> — send failure codes (Task 19 §8)', () => {
  async function setup() {
    useComposePanelStore.setState({
      isOpen: true,
      minimized: false,
      mode: 'new_mail',
      replyTo: null,
    });
    render(<ComposePanel mailboxes={mailboxes} />);
    await waitFor(() => expect(loadDraftSpy).toHaveBeenCalled());
    const to = screen.getByPlaceholderText('À (séparés par des virgules)');
    const subject = screen.getByPlaceholderText('Objet');
    await act(async () => {
      (to as HTMLInputElement).focus();
    });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(to, { target: { value: 'dest@example.com' } });
    fireEvent.change(subject, { target: { value: 'Sujet' } });
    return screen.getByRole('button', { name: /Envoyer/ });
  }

  it('ATTACHMENTS_NOT_READY shows an error toast and keeps the panel open', async () => {
    const { fireEvent } = await import('@testing-library/react');
    sendMailSpy.mockResolvedValueOnce({
      ok: false,
      code: 'ATTACHMENTS_NOT_READY',
      message: "Une ou plusieurs pièces jointes ne sont pas prêtes à l'envoi.",
    });
    const sendBtn = await setup();
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() =>
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          message: expect.stringContaining('pièces jointes ne sont pas prêtes'),
        }),
      ),
    );
    // Panel stays mounted (no `close()` side effect) — dialog still present.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('SEND_FAILED_TOO_LARGE shows the Graph 3 MB error toast', async () => {
    const { fireEvent } = await import('@testing-library/react');
    sendMailSpy.mockResolvedValueOnce({
      ok: false,
      code: 'SEND_FAILED_TOO_LARGE',
      message: 'Pièce(s) jointe(s) trop volumineuse(s) pour Exchange (max 3 Mo au total).',
    });
    const sendBtn = await setup();
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() =>
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          message: expect.stringContaining('Microsoft Graph'),
        }),
      ),
    );
  });

  it('SEND_FAILED_UNSUPPORTED shows an actionable error toast', async () => {
    const { fireEvent } = await import('@testing-library/react');
    sendMailSpy.mockResolvedValueOnce({
      ok: false,
      code: 'SEND_FAILED_UNSUPPORTED',
      message:
        'Les pièces jointes ne sont pas prises en charge en réponse/transfert via Exchange dans cette version — utilise le mode « Nouveau message ».',
    });
    const sendBtn = await setup();
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() =>
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          message: expect.stringContaining('Nouveau message'),
        }),
      ),
    );
  });
});
