/**
 * `packages/ui` has no dependency on `@nexushub/domain` (design system vs.
 * business logic — see repo CLAUDE.md §3). Client color values still reach
 * these components as a plain string (`Client.colorToken` in DB: a palette
 * token OR a free-form `#rrggbb`), so we re-validate here before it lands in
 * a `style` attribute — never trust it as a safe CSS fragment (CLAUDE.md
 * §4.5). Mirrors the allow-list in `@nexushub/domain/clients` without
 * importing it.
 */

const TOKEN_RE = /^c-[a-z]+$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Safe CSS value for a client color: token → CSS var, hex → as-is, else fallback. */
export function clientColorCss(value: string): string {
  if (TOKEN_RE.test(value)) return `var(--color-${value})`;
  if (HEX_RE.test(value)) return value;
  return 'var(--color-c-acme)';
}
