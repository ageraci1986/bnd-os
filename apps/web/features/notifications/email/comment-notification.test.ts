import { describe, expect, it } from 'vitest';
import { renderCommentNotificationEmail } from './comment-notification';

describe('renderCommentNotificationEmail', () => {
  const base = {
    recipientFirstName: 'Alice',
    authorDisplayName: 'Bob Martin',
    cardShortRef: 42,
    cardTitle: 'Refonte homepage',
    projectName: 'Site corporate',
    clientName: 'Acme Corp',
    commentBodyPreview: 'Bonjour, voici mes remarques.',
    commentUrl: 'https://nexushub.app/projects/p1?card=c1',
  };

  it('subject mentions the author + card title', () => {
    const { subject } = renderCommentNotificationEmail(base);
    expect(subject).toContain('Bob Martin');
    expect(subject).toContain('Refonte homepage');
  });

  it('text body greets the recipient', () => {
    const { text } = renderCommentNotificationEmail(base);
    expect(text).toContain('Salut Alice');
    expect(text).toContain('Bob Martin');
    expect(text).toContain('#42');
    expect(text).toContain('Refonte homepage');
    expect(text).toContain('Site corporate');
    expect(text).toContain('Acme Corp');
    expect(text).toContain('Bonjour, voici mes remarques.');
    expect(text).toContain('https://nexushub.app/projects/p1?card=c1');
  });

  it('html escapes < and > in dynamic strings', () => {
    const { htmlSanitized } = renderCommentNotificationEmail({
      ...base,
      authorDisplayName: 'Bob <script>',
      cardTitle: 'Refonte <img>',
    });
    expect(htmlSanitized).not.toContain('<script>');
    expect(htmlSanitized).not.toMatch(/<img\b/);
    expect(htmlSanitized).toContain('&lt;script&gt;');
    expect(htmlSanitized).toContain('&lt;img&gt;');
  });

  it('html includes the CTA url verbatim', () => {
    const { htmlSanitized } = renderCommentNotificationEmail(base);
    expect(htmlSanitized).toContain('https://nexushub.app/projects/p1?card=c1');
  });

  it('html includes the assignee-footer disclaimer', () => {
    const { htmlSanitized } = renderCommentNotificationEmail(base);
    expect(htmlSanitized).toContain('assigné à cette carte');
  });
});
