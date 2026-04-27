import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchBar } from './SearchBar';

describe('<SearchBar />', () => {
  it('renders an accessible search input', () => {
    render(<SearchBar />);
    expect(screen.getByRole('searchbox', { name: /Rechercher/ })).toBeInTheDocument();
  });

  it('honours the placeholder prop', () => {
    render(<SearchBar placeholder="Trouver un projet…" />);
    expect(screen.getByPlaceholderText('Trouver un projet…')).toBeInTheDocument();
  });

  it('disables the input when disabled', () => {
    render(<SearchBar disabled />);
    expect(screen.getByRole('searchbox')).toBeDisabled();
  });

  it('uses the provided default value', () => {
    render(<SearchBar defaultValue="Acme" />);
    expect(screen.getByRole('searchbox')).toHaveValue('Acme');
  });
});
