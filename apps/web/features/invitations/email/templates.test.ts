import { describe, expect, it } from 'vitest';
import { renderInvitationEmail } from './templates';

const baseParams = {
  inviterName: 'Angelo Lambert',
  workspaceName: 'Studio Atlas',
  acceptUrl: 'https://app.nexushub.app/signup/abc123.def456',
  expiresAt: new Date('2026-04-30T10:00:00Z'),
};

describe('renderInvitationEmail', () => {
  it('produces a non-empty subject containing the workspace name', () => {
    const r = renderInvitationEmail(baseParams);
    expect(r.subject).toContain('Studio Atlas');
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.subject.length).toBeLessThan(200);
  });

  it('embeds the accept URL exactly once in plain text', () => {
    const r = renderInvitationEmail(baseParams);
    const matches = r.text.match(new RegExp(escape(baseParams.acceptUrl), 'g')) ?? [];
    expect(matches.length).toBe(1);
  });

  it('embeds the accept URL in HTML href attribute', () => {
    const r = renderInvitationEmail(baseParams);
    expect(r.htmlSanitized).toContain(`href="${baseParams.acceptUrl}"`);
  });

  it('escapes HTML special chars in the inviter name', () => {
    const r = renderInvitationEmail({
      ...baseParams,
      inviterName: '<script>alert(1)</script>',
    });
    // Plain text body is fine to contain raw `<` (it's text/plain).
    // But the HTML must not contain an executable script tag.
    expect(r.htmlSanitized).not.toContain('<script>');
    expect(r.htmlSanitized).toContain('&lt;script&gt;');
  });

  it('escapes HTML special chars in the workspace name', () => {
    const r = renderInvitationEmail({
      ...baseParams,
      workspaceName: 'A & B "Studio"',
    });
    expect(r.htmlSanitized).toContain('A &amp; B &quot;Studio&quot;');
    // The plain text version preserves the original characters.
    expect(r.text).toContain('A & B "Studio"');
  });

  it('mentions single-use + expiry date', () => {
    const r = renderInvitationEmail(baseParams);
    expect(r.text).toMatch(/usage unique/i);
    // Avoid asserting the exact localized formatting; just ensure the year is there.
    expect(r.text).toContain('2026');
    expect(r.htmlSanitized).toContain('2026');
  });

  it('sets the Paris timezone for the expiry text', () => {
    const r = renderInvitationEmail({
      ...baseParams,
      expiresAt: new Date('2026-04-30T22:30:00Z'), // 00:30 next day in Paris (DST)
    });
    // 22:30 UTC = 00:30 Paris on 2026-05-01 during DST
    expect(r.text).toContain('1 mai 2026');
  });
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
