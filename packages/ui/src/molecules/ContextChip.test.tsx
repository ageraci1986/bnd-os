import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextChip } from './ContextChip';

describe('<ContextChip />', () => {
  it('renders the label', () => {
    render(<ContextChip label="Tous les clients" />);
    expect(screen.getByText('Tous les clients')).toBeInTheDocument();
  });

  it('omits the dot when no colorToken is given', () => {
    const { container } = render(<ContextChip label="Tous les clients" />);
    expect(container.querySelectorAll('span > span[role="presentation"]').length).toBe(0);
  });

  it('renders a dot when a colorToken is given', () => {
    const { container } = render(<ContextChip label="Acme" colorToken="c-acme" />);
    expect(container.querySelector('[role="presentation"]')).toBeTruthy();
  });

  it('omits the close button when onClear is not provided', () => {
    render(<ContextChip label="Inactive" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a close button and calls onClear', () => {
    const handle = vi.fn();
    render(<ContextChip label="Acme" colorToken="c-acme" onClear={handle} />);
    const btn = screen.getByRole('button', { name: /Retirer le filtre/i });
    btn.click();
    expect(handle).toHaveBeenCalledOnce();
  });

  it('honours the `active` prop in the className', () => {
    render(<ContextChip label="Acme" active onClear={() => undefined} />);
    expect(screen.getByText('Acme').parentElement?.className).toMatch(
      /accent-gradient-soft|accent-primary/,
    );
  });
});
