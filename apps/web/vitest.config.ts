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
    alias: {
      '@': path.resolve(__dirname),
      '@nexushub/db': path.resolve(__dirname, '../../packages/db/src/index.ts'),
      '@nexushub/domain': path.resolve(__dirname, '../../packages/domain/src/index.ts'),
      '@nexushub/integrations': path.resolve(__dirname, '../../packages/integrations/src/index.ts'),
      '@nexushub/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
});
