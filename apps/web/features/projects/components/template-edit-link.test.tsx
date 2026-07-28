import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { TemplateEditLink } from './template-edit-link';

describe('TemplateEditLink', () => {
  it('links to the editor deep-link when the card has a template', () => {
    render(<TemplateEditLink templateId="11111111-1111-1111-1111-111111111111" />);
    const link = screen.getByRole('link', { name: 'Modifier le template' });
    expect(link.getAttribute('href')).toBe(
      '/templates/cards?template=11111111-1111-1111-1111-111111111111',
    );
  });

  it('offers template management when the card has no template', () => {
    render(<TemplateEditLink templateId={null} />);
    expect(screen.getByText(/Aucun template appliqué/)).toBeDefined();
    const link = screen.getByRole('link', { name: 'Gérer les templates' });
    expect(link.getAttribute('href')).toBe('/templates/cards');
  });
});
