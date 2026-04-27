import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tag } from './Tag';

describe('<Tag />', () => {
  it('renders children content', () => {
    render(<Tag variant="success">Done</Tag>);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('applies a variant-specific class', () => {
    render(<Tag variant="danger">Bloqué</Tag>);
    expect(screen.getByText('Bloqué').className).toMatch(/danger/);
  });

  it('renders all 11 variants without crashing', () => {
    const variants = [
      'success',
      'danger',
      'warning',
      'info',
      'primary',
      'design',
      'copy',
      'video',
      'strategy',
      'tiktok',
      'insta',
    ] as const;
    variants.forEach((v) => {
      const { unmount } = render(<Tag variant={v}>{v}</Tag>);
      expect(screen.getByText(v)).toBeInTheDocument();
      unmount();
    });
  });

  it('appends extra className', () => {
    render(
      <Tag variant="info" className="custom">
        x
      </Tag>,
    );
    expect(screen.getByText('x').className).toMatch(/custom/);
  });
});
