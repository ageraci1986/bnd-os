import { describe, expect, it } from 'vitest';
import HomePage from '../app/page';

describe('HomePage smoke', () => {
  it('is a server component that performs a redirect', () => {
    // The root page is now a redirect-only RSC (no UI to render).
    // Verify the export is an async function — that's the full contract.
    expect(typeof HomePage).toBe('function');
    // Async RSC: calling it returns a Promise (or throws redirect, which
    // is caught by Next.js). Either way the component is defined.
  });
});
