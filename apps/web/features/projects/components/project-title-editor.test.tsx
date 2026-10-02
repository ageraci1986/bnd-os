import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mocked fns must be created via `vi.hoisted` (repo convention, see
// `project-core.test.ts`) rather than plain top-level `const`s.
const mocks = vi.hoisted(() => ({
  renameProject: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('../actions/rename-project', () => ({ renameProject: mocks.renameProject }));
vi.mock('@/features/shell/components/toaster', () => ({ notify: mocks.notify }));

import { ProjectTitleEditor } from './project-title-editor';

const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  mocks.renameProject.mockReset();
  mocks.notify.mockReset();
});

function startEditing() {
  fireEvent.click(screen.getByRole('button', { name: 'Renommer le projet' }));
  return screen.getByRole('textbox', { name: 'Nom du projet' });
}

describe('<ProjectTitleEditor />', () => {
  it('hides the pencil when the user cannot edit', () => {
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit={false} />);
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renommer le projet' })).toBeNull();
  });

  it('saves on Enter (optimistic)', async () => {
    mocks.renameProject.mockResolvedValue({ ok: true, name: 'Beta' });
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit />);
    const input = startEditing();
    fireEvent.change(input, { target: { value: 'Beta' } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(mocks.renameProject).toHaveBeenCalledWith({ projectId: ID, name: 'Beta' });
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
  });

  it('cancels on Escape without saving', () => {
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit />);
    const input = startEditing();
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mocks.renameProject).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('does not call the server for an empty or unchanged name', () => {
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit />);
    const input = startEditing();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(mocks.renameProject).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('rolls back and toasts on error', async () => {
    mocks.renameProject.mockResolvedValue({ ok: false, message: 'Un projet porte déjà ce nom.' });
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit />);
    const input = startEditing();
    fireEvent.change(input, { target: { value: 'Dup' } });
    await act(async () => fireEvent.blur(input));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument());
    expect(mocks.notify).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Un projet porte déjà ce nom.',
    });
  });
});
