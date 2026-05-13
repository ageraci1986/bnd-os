/**
 * Deterministic colour for a user-defined card category.
 *
 * Built-in categories (Stratégie, Design, Copy…) already map to fixed
 * Tag variants in the design system. For workspace-defined categories
 * we don't store a colour anywhere, so we hash the label into one of
 * a small palette so the same custom name always renders the same
 * colour across the app.
 */

const PALETTE: readonly { readonly bg: string; readonly fg: string }[] = [
  { bg: 'rgba(255, 42, 109, 0.12)', fg: '#d11a5b' }, // rose / brand
  { bg: 'rgba(37, 99, 235, 0.12)', fg: '#1d4ed8' }, // bleu
  { bg: 'rgba(5, 150, 105, 0.12)', fg: '#047857' }, // vert
  { bg: 'rgba(217, 119, 6, 0.14)', fg: '#b45309' }, // ambre
  { bg: 'rgba(139, 43, 226, 0.12)', fg: '#7c1ed1' }, // violet / brand
  { bg: 'rgba(8, 145, 178, 0.12)', fg: '#0e7490' }, // cyan
  { bg: 'rgba(225, 29, 72, 0.12)', fg: '#be123c' }, // framboise
  { bg: 'rgba(101, 163, 13, 0.14)', fg: '#4d7c0f' }, // lime
];

export interface CustomCategoryColor {
  readonly bg: string;
  readonly fg: string;
}

export function customCategoryColor(name: string): CustomCategoryColor {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const slot = PALETTE[h % PALETTE.length];
  // Fallback should never trigger — palette is constant and non-empty —
  // but it makes the return type narrow without a non-null assertion.
  return slot ?? { bg: 'rgba(107,114,128,0.15)', fg: '#374151' };
}
