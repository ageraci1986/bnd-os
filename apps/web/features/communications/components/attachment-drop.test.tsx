import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachmentDrop } from './attachment-drop';
import { MAX_ATTACHMENTS, type UploadedAttachment } from '../hooks/use-attachment-uploader';

function item(overrides: Partial<UploadedAttachment> = {}): UploadedAttachment {
  return {
    id: '1',
    filename: 'report.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    storagePath: 'w/1',
    sha256: 'a'.repeat(64),
    state: 'clean',
    ...overrides,
  };
}

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'text/plain' });
}

describe('<AttachmentDrop />', () => {
  it('renders the drop zone with no item list when there are no attachments', () => {
    render(<AttachmentDrop items={[]} totalBytes={0} onDrop={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/Glisse tes fichiers ici/)).toBeInTheDocument();
    expect(screen.queryByText(/Pièces jointes/)).not.toBeInTheDocument();
  });

  it('picking files via the hidden input calls onDrop with the selected files', () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    render(<AttachmentDrop items={[]} totalBytes={0} onDrop={onDrop} onRemove={vi.fn()} />);

    const input = screen.getByLabelText('Ajouter des pièces jointes') as HTMLInputElement;
    const file = makeFile('doc.pdf');
    fireEvent.change(input, { target: { files: [file] } });

    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop.mock.calls[0]?.[0]).toEqual([file]);
  });

  it('the drop zone label wraps a real file input (keyboard accessible)', () => {
    render(<AttachmentDrop items={[]} totalBytes={0} onDrop={vi.fn()} onRemove={vi.fn()} />);
    const input = screen.getByLabelText('Ajouter des pièces jointes');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('multiple');
  });

  it('shows the summary line with count and total size once there are attachments', () => {
    render(
      <AttachmentDrop
        items={[item({ id: '1' }), item({ id: '2', filename: 'b.txt' })]}
        totalBytes={2048}
        onDrop={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/Pièces jointes \(2 · 2\.0 KB \/ 25 MB\)/)).toBeInTheDocument();
  });

  it('shows an over-limit warning when totalBytes exceeds 25 MB', () => {
    render(
      <AttachmentDrop
        items={[item({ sizeBytes: 26 * 1024 * 1024 })]}
        totalBytes={26 * 1024 * 1024}
        onDrop={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/Dépasse 25 MB/)).toBeInTheDocument();
  });

  it('renders the uploading state with a progress indicator', () => {
    render(
      <AttachmentDrop
        items={[item({ state: 'uploading' })]}
        totalBytes={1024}
        onDrop={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/Analyse antivirus…/)).toBeInTheDocument();
  });

  it('renders the clean state with a ready indicator', () => {
    render(
      <AttachmentDrop
        items={[item({ state: 'clean' })]}
        totalBytes={1024}
        onDrop={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    // "Prêt" appears both in the visible (aria-hidden) glyph and the
    // sr-only accessible-name mirror — assert on the accessible text.
    expect(screen.getAllByText(/Prêt/).length).toBeGreaterThan(0);
  });

  it('renders the dirty state with a "Retirer" button', () => {
    render(
      <AttachmentDrop
        items={[item({ id: 'd1', state: 'dirty' })]}
        totalBytes={1024}
        onDrop={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    // The status text is rendered twice by design: once visually
    // (aria-hidden, so screen readers skip the redundant "⚠" glyph) and
    // once in a `.sr-only` span carrying the accessible equivalent.
    expect(screen.getAllByText(/Bloqué par l'antivirus/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retirer report.pdf' })).toHaveTextContent('Retirer');
  });

  it('renders the error state with its message and a "Retirer" button', () => {
    render(
      <AttachmentDrop
        items={[item({ id: 'e1', state: 'error', error: 'Échec réseau' })]}
        totalBytes={1024}
        onDrop={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/Échec réseau/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retirer report.pdf' })).toBeInTheDocument();
  });

  it('fires onRemove with the item id when the remove button is clicked', () => {
    const onRemove = vi.fn();
    render(
      <AttachmentDrop
        items={[item({ id: 'abc' })]}
        totalBytes={1024}
        onDrop={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retirer report.pdf' }));
    expect(onRemove).toHaveBeenCalledWith('abc');
  });

  it('disables the drop zone and shows helper text once the 20-file cap is reached', () => {
    const items = Array.from({ length: MAX_ATTACHMENTS }, (_, i) =>
      item({ id: `f${i}`, filename: `f${i}.txt` }),
    );
    render(<AttachmentDrop items={items} totalBytes={0} onDrop={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText('Limite de 20 pièces jointes atteinte.')).toBeInTheDocument();
    const input = screen.getByLabelText('Ajouter des pièces jointes') as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  it('disables the drop zone entirely when the disabled prop is set', () => {
    render(
      <AttachmentDrop items={[]} totalBytes={0} onDrop={vi.fn()} onRemove={vi.fn()} disabled />,
    );
    const input = screen.getByLabelText('Ajouter des pièces jointes') as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  it('does not call onDrop when dropping onto a disabled zone', () => {
    const onDrop = vi.fn();
    render(
      <AttachmentDrop items={[]} totalBytes={0} onDrop={onDrop} onRemove={vi.fn()} disabled />,
    );
    const label = screen.getByText(/Glisse tes fichiers ici/).closest('label')!;
    const file = makeFile('doc.pdf');
    fireEvent.drop(label, { dataTransfer: { files: [file] } });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
