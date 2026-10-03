/**
 * Préférence de thème utilisateur (spec lot B). `system` suit l'OS
 * (`prefers-color-scheme`) et reste la valeur par défaut / de repli.
 */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type EffectiveTheme = Exclude<ThemePreference, 'system'>;

/** Valeur sûre depuis un cookie / une entrée non fiable ; repli `system`. */
export function parseThemePreference(value: unknown): ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : 'system';
}

/** Bouton topbar : bascule vers le thème opposé à celui affiché. */
export function oppositeTheme(effective: EffectiveTheme): EffectiveTheme {
  return effective === 'dark' ? 'light' : 'dark';
}
