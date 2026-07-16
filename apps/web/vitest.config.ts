import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['**/*.test.{ts,tsx}', '!**/*.e2e.test.ts'],
    exclude: ['node_modules', '.next', 'e2e'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: ['node_modules', '.next', 'app/layout.tsx', '**/*.test.{ts,tsx}', '**/*.config.*'],
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: '@nexushub/integrations/graph',
        replacement: path.resolve(__dirname, '../../packages/integrations/src/graph/index.ts'),
      },
      {
        find: '@nexushub/integrations/slack',
        replacement: path.resolve(__dirname, '../../packages/integrations/src/slack/index.ts'),
      },
      {
        find: '@nexushub/integrations/email',
        replacement: path.resolve(__dirname, '../../packages/integrations/src/email/index.ts'),
      },
      {
        find: '@nexushub/integrations/imap',
        replacement: path.resolve(__dirname, '../../packages/integrations/src/imap/index.ts'),
      },
      {
        find: '@nexushub/integrations',
        replacement: path.resolve(__dirname, '../../packages/integrations/src/index.ts'),
      },
      {
        find: '@nexushub/db',
        replacement: path.resolve(__dirname, '../../packages/db/src/index.ts'),
      },
      {
        find: '@nexushub/domain',
        replacement: path.resolve(__dirname, '../../packages/domain/src/index.ts'),
      },
      {
        find: '@nexushub/ui',
        replacement: path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      },
      { find: '@', replacement: path.resolve(__dirname) },
      // Stub Next's `server-only` marker in tests (it throws at import in non-RSC contexts).
      { find: 'server-only', replacement: path.resolve(__dirname, 'test/stubs/server-only.ts') },
    ],
  },
});
