import type { StorybookConfig } from '@storybook/nextjs-vite';
import type { Plugin } from 'vite';

import { dirname, resolve } from 'path';

import { fileURLToPath } from 'url';
import { mergeConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

/**
 * Server Actions (`'use server'`) reachable from the storified assistant
 * widgets, mapped to Storybook-only stubs in `.storybook/mocks/`. The real
 * files import `@nexushub/db` (Prisma) and Node-only integration code
 * (IMAP, etc.) that cannot run in a browser bundle — `@storybook/nextjs-vite`
 * neutralizes the `server-only` marker package itself (see its bundled
 * `alias/rsc/server-only` stub), but NOT the rest of these files' imports,
 * so without this map the widgets crash at story render (verified: Prisma's
 * generated client tries to load its `.prisma/client/index-browser` entry
 * and the browser's ES module loader rejects the bare specifier).
 *
 * Matched by RESOLVED ABSOLUTE PATH, not import specifier text — Vite's
 * plain `resolve.alias` only matches the specifier as written, and these
 * files are imported both via the `@/*` tsconfig alias (from the widgets
 * directly) and via relative paths (e.g. `RecipientField` importing
 * `../actions/search-recipients`). Resolving first and comparing paths
 * catches every call site uniformly.
 */
const MOCKED_ACTIONS: ReadonlyMap<string, string> = new Map([
  [
    resolve(here, '../features/communications/actions/fetch-mail-body.ts'),
    resolve(here, 'mocks/fetch-mail-body.ts'),
  ],
  [
    resolve(here, '../features/communications/actions/mark-email-read.ts'),
    resolve(here, 'mocks/mark-email-read.ts'),
  ],
  [
    resolve(here, '../features/communications/actions/mark-email-unread.ts'),
    resolve(here, 'mocks/mark-email-unread.ts'),
  ],
  [
    resolve(here, '../features/communications/actions/mail-drafts.ts'),
    resolve(here, 'mocks/mail-drafts.ts'),
  ],
  [
    resolve(here, '../features/communications/actions/search-recipients.ts'),
    resolve(here, 'mocks/search-recipients.ts'),
  ],
]);

function mockServerActionsPlugin(): Plugin {
  return {
    name: 'nexushub-mock-server-actions',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (importer === undefined) return null;
      // `skipSelf` avoids recursing back into this same hook once we return
      // the mock's path below (the mock files themselves import nothing
      // from this map, but this keeps the hook correct regardless).
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved === null) return null;
      return MOCKED_ACTIONS.get(resolved.id) ?? null;
    },
  };
}

const config: StorybookConfig = {
  // Stories live next to the components they document (Plan 4 Task 6) —
  // no separate `stories/` sample folder.
  stories: ['../features/**/*.stories.tsx'],
  addons: [
    // Essentials (controls/actions/viewport/backgrounds/…) ship in
    // Storybook core as of v9+ — only docs (split out in v10) and a11y
    // (WCAG 2.1 AA requirement, CLAUDE.md §5.3) are added explicitly.
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-docs'),
  ],
  framework: getAbsolutePath('@storybook/nextjs-vite'),
  viteFinal: async (viteConfig) =>
    mergeConfig(viteConfig, {
      plugins: [mockServerActionsPlugin()],
    }),
};

export default config;
