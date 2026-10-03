import { describe, expect, it } from 'vitest';
import { THEME_PREFERENCES, oppositeTheme, parseThemePreference } from './index';

describe('THEME_PREFERENCES', () => {
  it('lists the three modes, system first (default)', () => {
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark']);
  });
});

describe('parseThemePreference', () => {
  it('accepts the three known values', () => {
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
  });
  it('falls back to system for anything else', () => {
    expect(parseThemePreference(undefined)).toBe('system');
    expect(parseThemePreference('')).toBe('system');
    expect(parseThemePreference('DARK')).toBe('system');
    expect(parseThemePreference('dark;x')).toBe('system');
    expect(parseThemePreference(1)).toBe('system');
  });
});

describe('oppositeTheme', () => {
  it('flips light and dark', () => {
    expect(oppositeTheme('light')).toBe('dark');
    expect(oppositeTheme('dark')).toBe('light');
  });
});
