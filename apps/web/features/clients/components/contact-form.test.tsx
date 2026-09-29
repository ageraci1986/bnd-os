import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { refresh, createContact } = vi.hoisted(() => ({
  refresh: vi.fn(),
  createContact: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('../actions/create-contact', () => ({ createContact }));
vi.mock('../actions/update-contact', () => ({ updateContact: vi.fn() }));

import { ContactForm } from './contact-form';

const CLIENT_ID = '22222222-2222-2222-2222-222222222222';

function renderForm() {
  return render(<ContactForm mode="create" csrfToken="csrf" clientId={CLIENT_ID} />);
}

async function submit(firstName: string) {
  fireEvent.change(screen.getByPlaceholderText('Prénom'), { target: { value: firstName } });
  fireEvent.change(screen.getByPlaceholderText('Nom'), { target: { value: 'Durand' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ajouter le contact/ }));
  });
}

beforeEach(() => {
  refresh.mockReset();
  createContact.mockReset();
  createContact.mockImplementation(async () => ({
    status: 'success',
    contactId: crypto.randomUUID(),
  }));
});

describe('<ContactForm mode="create" />', () => {
  it('does not keep refreshing after a successful create (no refresh loop)', async () => {
    const { rerender } = renderForm();
    await submit('Alice');
    const afterCreate = refresh.mock.calls.length;
    // A router refresh re-renders the parent with fresh props.
    rerender(<ContactForm mode="create" csrfToken="csrf" clientId={CLIENT_ID} />);
    rerender(<ContactForm mode="create" csrfToken="csrf" clientId={CLIENT_ID} />);
    expect(refresh.mock.calls.length).toBe(afterCreate);
  });

  it('lets the user add a second contact right away', async () => {
    renderForm();
    await submit('Alice');
    expect((screen.getByPlaceholderText('Prénom') as HTMLInputElement).value).toBe('');
    await submit('Bob');
    expect(createContact).toHaveBeenCalledTimes(2);
    const second = createContact.mock.calls[1]?.[1] as FormData;
    expect(second.get('firstName')).toBe('Bob');
    expect((screen.getByPlaceholderText('Prénom') as HTMLInputElement).value).toBe('');
  });

  it('resets the RACI choice between two contacts', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'R' }));
    await submit('Alice');
    expect(createContact.mock.calls[0]?.[1].get('raci')).toBe('responsible');
    await submit('Bob');
    expect(createContact.mock.calls[1]?.[1].get('raci')).toBe('');
  });
});
