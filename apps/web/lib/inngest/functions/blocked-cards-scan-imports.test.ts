import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pinned guard (Plan 3b Task 5 — same rationale as
 * `morning-briefing-imports.test.ts`): the hourly blocked-cards-scan Inngest
 * function never runs an agent turn (it's the deterministic §6.3 scan +
 * notice creation), so it must never import the agent provider or tool
 * registry either. See that file's header comment for why static source
 * inspection (not `vi.mock`) is the right method here.
 */

const FORBIDDEN_SPECIFIER_PATTERNS: readonly RegExp[] = [
  /@nexushub\/agent/,
  /\/provider(\.|['"]|$)/i,
  /\/registry(\.|['"]|$)/i,
];

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
  // filename is always one of the literal strings passed by the `it()`
  // blocks below (never external/user input) — safe despite the dynamic
  // join() the security linter can't statically prove.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = readFileSync(join(__dirname, filename), 'utf8');
  const specifiers = importSpecifiers(source);
  for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) {
    const offender = specifiers.find((specifier) => pattern.test(specifier));
    expect(offender, `${filename} must not import a specifier matching ${pattern}`).toBeUndefined();
  }
  expect(source).not.toMatch(/\brunTurn\b/);
}

describe('Inngest functions — no provider/registry import (pinned)', () => {
  it('blocked-cards-scan.ts imports neither @nexushub/agent, provider, nor registry', () => {
    assertNoForbiddenImports('blocked-cards-scan.ts');
  });
});
