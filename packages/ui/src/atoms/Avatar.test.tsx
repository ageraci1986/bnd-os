import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('<Avatar />', () => {
  it('renders the initials (truncated to 4 chars)', () => {
    render(<Avatar initials="ABCDEF" />);
    expect(screen.getByRole('img')).toHaveTextContent('ABCD');
  });

  it('uses an aria-label fallback to the initials when no title', () => {
    render(<Avatar initials="AL" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('AL');
  });

  it('honours the title prop as accessible name', () => {
    render(<Avatar initials="AL" title="Angelo Lambert" />);
    expect(screen.getByRole('img', { name: 'Angelo Lambert' })).toBeInTheDocument();
  });

  it('hides itself from a11y when ariaHidden is true', () => {
    render(<Avatar initials="AL" ariaHidden />);
    // role="img" is removed when aria-hidden is set
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('applies the gradient variant via inline style', () => {
    render(<Avatar initials="AL" variant="gradient" />);
    const el = screen.getByRole('img');
    expect(el.getAttribute('style')).toMatch(/linear-gradient/);
  });

  it('applies the client variant with the provided color', () => {
    render(<Avatar initials="AB" variant="client" color="#FF2A6D" />);
    const el = screen.getByRole('img');
    // jsdom normalises hex colors in `style` attributes to rgb(…)
    expect(el.getAttribute('style')).toMatch(/rgb\(255, ?42, ?109\)|#FF2A6D/i);
  });
});
