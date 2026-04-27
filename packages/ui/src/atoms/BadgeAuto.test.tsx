import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BadgeAuto } from './BadgeAuto';

describe('<BadgeAuto />', () => {
  it('renders the default "Auto" label', () => {
    render(<BadgeAuto />);
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('honours a custom label', () => {
    render(<BadgeAuto label="Système" />);
    expect(screen.getByText('Système')).toBeInTheDocument();
  });

  it('renders the gradient inline style', () => {
    const { container } = render(<BadgeAuto />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute('style')).toMatch(/linear-gradient/);
  });
});
