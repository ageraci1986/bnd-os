import { describe, expect, it } from 'vitest';
import { resolveMailPage } from './resolve-mail-page';

describe('resolveMailPage', () => {
  it('returns page 1 when the mail is the very first (0 newer mails)', () => {
    expect(resolveMailPage({ newerCount: 0, pageSize: 50 })).toBe(1);
  });

  it('returns page 1 when the mail is the last row of page 1 (49 newer mails)', () => {
    expect(resolveMailPage({ newerCount: 49, pageSize: 50 })).toBe(1);
  });

  it('returns page 2 when the mail is the first row of page 2 (50 newer mails)', () => {
    expect(resolveMailPage({ newerCount: 50, pageSize: 50 })).toBe(2);
  });

  it('returns page 3 when the mail has 120 newer mails ahead of it', () => {
    expect(resolveMailPage({ newerCount: 120, pageSize: 50 })).toBe(3);
  });
});
