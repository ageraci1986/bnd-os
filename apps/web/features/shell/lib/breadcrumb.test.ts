import { describe, expect, it } from 'vitest';
import { pathnameToLabel } from './breadcrumb';

describe('pathnameToLabel', () => {
  it('matches exact known routes', () => {
    expect(pathnameToLabel('/overview')).toBe('Tableau de bord');
    expect(pathnameToLabel('/projects')).toBe('Projets');
    expect(pathnameToLabel('/team')).toBe('Équipe');
    expect(pathnameToLabel('/templates/email')).toBe('Templates e-mail');
    expect(pathnameToLabel('/templates/kanban')).toBe('Templates Kanban');
  });

  it('falls back to the longest prefix for nested routes', () => {
    expect(pathnameToLabel('/projects/abc-123')).toBe('Projets');
    expect(pathnameToLabel('/projects/abc-123/cards/xyz')).toBe('Projets');
    expect(pathnameToLabel('/templates/email/duplicate-1')).toBe('Templates e-mail');
  });

  it('prefers more-specific prefixes over less-specific ones', () => {
    // /templates/email is longer than /templates so should win
    expect(pathnameToLabel('/templates/email/foo')).toBe('Templates e-mail');
  });

  it('falls back to the last segment for unknown routes', () => {
    expect(pathnameToLabel('/foo')).toBe('Foo');
    expect(pathnameToLabel('/bar/baz')).toBe('Baz');
  });

  it('handles the root path defensively', () => {
    expect(pathnameToLabel('/')).toBe('');
  });
});
