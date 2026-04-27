import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../app/page';

describe('HomePage smoke', () => {
  it('renders the brand', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /NexusHub/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Se connecter/i })).toBeInTheDocument();
  });
});
