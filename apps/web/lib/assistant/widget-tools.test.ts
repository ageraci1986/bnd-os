import { describe, expect, it } from 'vitest';
import { isWidgetTool } from './widget-tools';

describe('isWidgetTool', () => {
  it('accepte find_projects (même pipeline widget que list_projects)', () => {
    expect(isWidgetTool('find_projects')).toBe(true);
    expect(isWidgetTool('list_projects')).toBe(true);
  });

  it('rejette un nom de tool hors whitelist', () => {
    expect(isWidgetTool('delete_card')).toBe(false);
    expect(isWidgetTool('some_unknown_tool')).toBe(false);
  });

  it('accepte create_mail_draft et prepare_reply_draft (mutations à widget, comme les tools mémoire)', () => {
    expect(isWidgetTool('create_mail_draft')).toBe(true);
    expect(isWidgetTool('prepare_reply_draft')).toBe(true);
  });

  it('rejette get_draft/send_draft (lecture / gated, pas des widgets)', () => {
    expect(isWidgetTool('get_draft')).toBe(false);
    expect(isWidgetTool('send_draft')).toBe(false);
  });
});
