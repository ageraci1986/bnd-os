import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pinned guard (Plan 3b Task 4 — replaces spec §8's "autoDeny verified"
 * requirement, moot here since no agent turn ever runs in a cron): the
 * Inngest morning-briefing function and the function registry that serves
 * it must NEVER import the agent provider or tool registry. A cron that
 * pulled in `@nexushub/agent`'s provider/registry would risk an accidental
 * Anthropic call from a background job with no user in the loop — exactly
 * what the "zero-token briefing" architecture decision (plan Architecture
 * section) rules out.
 *
 * METHOD: static inspection of the raw import specifiers in the source
 * file, not a `vi.mock` assertion. A missing `vi.mock('@nexushub/agent')`
 * proves nothing on its own (the mock could simply be unused because the
 * import was never exercised, or removed without anyone noticing) — running
 * `require`/`import` and checking `vi.mocked` calls only tells you the
 * import didn't THROW, not that it doesn't exist. Reading the literal
 * `import ... from '...'` specifiers is the only way to positively assert
 * their absence, and it's robust to how the module is later loaded/mocked
 * in unrelated tests.
 */

const FORBIDDEN_SPECIFIER_PATTERNS: readonly RegExp[] = [
  /@nexushub\/agent/,
  /\/provider(\.|['"]|$)/i,
  /\/registry(\.|['"]|$)/i,
];

// Deliberately two SIMPLE, bounded patterns (no nested/lazy quantifiers like
// `[\s\S]*?`) rather than one clever combined regex — a more "complete"
// single-pass import parser tripped `security/detect-unsafe-regex`, and
// splitting per-import-style keeps each pattern linear and easy to audit.
const FROM_IMPORT_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(FROM_IMPORT_RE)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  for (const match of source.matchAll(BARE_IMPORT_RE)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}

function assertNoForbiddenImports(filename: string) {
  // filename is always one of the two literal strings passed by the `it()`
  // blocks below (never external/user input) — safe despite the dynamic
  // join() the security linter can't statically prove.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = readFileSync(join(__dirname, filename), 'utf8');
  const specifiers = importSpecifiers(source);
  for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) {
    const offender = specifiers.find((specifier) => pattern.test(specifier));
    expect(offender, `${filename} must not import a specifier matching ${pattern}`).toBeUndefined();
  }
  // Belt-and-suspenders: no direct reference to runTurn anywhere in the
  // source (import alias, dynamic import, re-export...).
  expect(source).not.toMatch(/\brunTurn\b/);
}

describe('Inngest functions — no provider/registry import (pinned)', () => {
  it('morning-briefing.ts imports neither @nexushub/agent, provider, nor registry', () => {
    assertNoForbiddenImports('morning-briefing.ts');
  });

  it('functions/index.ts imports neither @nexushub/agent, provider, nor registry', () => {
    assertNoForbiddenImports('index.ts');
  });
});
