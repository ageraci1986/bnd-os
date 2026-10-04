import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pinned guard (lot C — same rationale as `blocked-cards-scan-imports.test.ts`):
 * the card-attachment scan and cleanup Inngest functions never run an agent
 * turn (deterministic Storage + ClamAV + DB work), so they must never import
 * the agent provider or tool registry either. Static source inspection, not
 * `vi.mock` — see `morning-briefing-imports.test.ts` for why.
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
  // blocks below (never external/user input).
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = readFileSync(join(__dirname, filename), 'utf8');
  const specifiers = importSpecifiers(source);
  for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) {
    const offender = specifiers.find((specifier) => pattern.test(specifier));
    expect(offender, `${filename} must not import a specifier matching ${pattern}`).toBeUndefined();
  }
  expect(source).not.toMatch(/\brunTurn\b/);
}

describe('Inngest card-attachment functions — no provider/registry import (pinned)', () => {
  it('scan-card-attachment.ts imports neither @nexushub/agent, provider, nor registry', () => {
    assertNoForbiddenImports('scan-card-attachment.ts');
  });

  it('card-attachments-cleanup.ts imports neither @nexushub/agent, provider, nor registry', () => {
    assertNoForbiddenImports('card-attachments-cleanup.ts');
  });

  it('functions/index.ts imports neither @nexushub/agent, provider, nor registry', () => {
    assertNoForbiddenImports('index.ts');
  });
});
