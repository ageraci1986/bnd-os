import { describe, expect, it } from 'vitest';
import {
  buildHrefWithClient,
  CLIENT_FILTER_PARAM,
  clientSlugFromName,
  isOutsideClientFilter,
} from './client-filter-url';

describe('CLIENT_FILTER_PARAM', () => {
  it('is "client"', () => {
    expect(CLIENT_FILTER_PARAM).toBe('client');
  });
});

describe('buildHrefWithClient', () => {
  it('adds the param when none was set', () => {
    expect(buildHrefWithClient('/overview', null, 'acme')).toBe('/overview?client=acme');
  });

  it('removes the param when slug is null', () => {
    expect(buildHrefWithClient('/overview', 'client=acme', null)).toBe('/overview');
  });

  it('preserves other search params', () => {
    expect(buildHrefWithClient('/projects', 'view=kanban&sort=due', 'tech')).toBe(
      '/projects?view=kanban&sort=due&client=tech',
    );
  });

  it('replaces an existing client param', () => {
    expect(buildHrefWithClient('/team', 'client=acme&page=2', 'tech')).toBe(
      '/team?client=tech&page=2',
    );
  });

  it('returns just the pathname when query becomes empty', () => {
    expect(buildHrefWithClient('/overview', 'client=acme', null)).toBe('/overview');
  });

  it('accepts a URLSearchParams instance', () => {
    const sp = new URLSearchParams('view=kanban');
    expect(buildHrefWithClient('/projects', sp, 'lumen')).toBe(
      '/projects?view=kanban&client=lumen',
    );
  });

  it('handles undefined search', () => {
    expect(buildHrefWithClient('/overview', undefined, 'orbit')).toBe('/overview?client=orbit');
  });
});

describe('clientSlugFromName', () => {
  it('lowercases and dashes whitespace', () => {
    expect(clientSlugFromName('Casa  47 Studio')).toBe('casa-47-studio');
  });
});

describe('isOutsideClientFilter', () => {
  const client = { id: 'c-uuid-1', name: 'Casa 47' };

  it('is false without a filter', () => {
    expect(isOutsideClientFilter(null, client)).toBe(false);
  });

  it('is false when the filter is the project client (slug or id)', () => {
    expect(isOutsideClientFilter('casa-47', client)).toBe(false);
    expect(isOutsideClientFilter('CASA-47', client)).toBe(false);
    expect(isOutsideClientFilter('c-uuid-1', client)).toBe(false);
  });

  it('is true when the filter targets another client', () => {
    expect(isOutsideClientFilter('acme', client)).toBe(true);
  });
});
