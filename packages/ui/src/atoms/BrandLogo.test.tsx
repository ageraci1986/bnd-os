import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogo } from './BrandLogo';

describe('<BrandLogo />', () => {
  it('exposes a single accessible name "BND OS"', () => {
    render(<BrandLogo />);
    const logo = screen.getByRole('img', { name: 'BND OS' });
    expect(logo).toHaveClass('bnd-logo');
    expect(logo).not.toHaveClass('is-lg');
  });

  it('keeps the spark on brand tokens (plasma dot, yellow star)', () => {
    const { container } = render(<BrandLogo />);
    expect(container.querySelector('circle')?.getAttribute('fill')).toBe(
      'var(--color-accent-secondary)',
    );
    expect(container.querySelector('path')?.getAttribute('fill')).toBe(
      'var(--color-accent-primary)',
    );
  });

  it('supports the large size', () => {
    render(<BrandLogo size="lg" />);
    expect(screen.getByRole('img', { name: 'BND OS' })).toHaveClass('is-lg');
  });
});
