import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((d) => {
      const [name = '', ...rest] = d.trim().split(/\s+/);
      return [name, rest.join(' ')];
    }),
  );
}

describe('buildCsp', () => {
  const HOST = 'abc.supabase.co';

  it('allows card attachment media from self, blob: and the Supabase host only', () => {
    const d = directives(buildCsp({ nonce: 'n0nce', supabaseHost: HOST, isProd: true }));
    expect(d.get('media-src')).toBe(`'self' blob: https://${HOST}`);
  });

  it('allows framing only self and blob: (PDF preview), never the Storage host', () => {
    const d = directives(buildCsp({ nonce: 'n0nce', supabaseHost: HOST, isProd: true }));
    expect(d.get('frame-src')).toBe(`'self' blob:`);
    expect(d.get('frame-src')).not.toContain(HOST);
    expect(d.get('frame-ancestors')).toBe(`'none'`);
    expect(d.get('object-src')).toBe(`'none'`);
  });

  it('nonces scripts and only allows unsafe-eval outside production', () => {
    const prod = directives(buildCsp({ nonce: 'abc', supabaseHost: HOST, isProd: true }));
    expect(prod.get('script-src')).toBe(`'self' 'nonce-abc' 'strict-dynamic'`);
    const dev = directives(buildCsp({ nonce: 'abc', supabaseHost: HOST, isProd: false }));
    expect(dev.get('script-src')).toContain(`'unsafe-eval'`);
  });
});
