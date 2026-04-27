import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ClientDot } from './ClientDot';

describe('<ClientDot />', () => {
  it('uses CSS var for known tokens', () => {
    const { container } = render(<ClientDot colorToken="c-acme" />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute('style')).toMatch(/var\(--color-c-acme\)/);
  });

  it('uses literal color for unknown tokens', () => {
    const { container } = render(<ClientDot colorToken="#FF0000" />);
    const el = container.firstChild as HTMLElement;
    // jsdom normalises hex colors in `style` attributes to rgb(…)
    expect(el.getAttribute('style')).toMatch(/rgb\(255, ?0, ?0\)|#FF0000/i);
  });

  it('honours the size prop', () => {
    const { container } = render(<ClientDot colorToken="c-tech" size={12} />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute('style')).toMatch(/width: 12px/);
    expect(el.getAttribute('style')).toMatch(/height: 12px/);
  });

  it('default size is 8 px', () => {
    const { container } = render(<ClientDot colorToken="c-nova" />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute('style')).toMatch(/width: 8px/);
  });
});
