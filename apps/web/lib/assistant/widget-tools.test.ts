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
});
