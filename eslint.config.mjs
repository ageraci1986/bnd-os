// Flat config — root. Workspaces extend this and add Next-specific rules.
// Phase 1.2 baseline. Tightened in Phase 12 (security).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import securityPlugin from 'eslint-plugin-security';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/storybook-static/**',
      '**/*.generated.*',
      'mockups/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    plugins: {
      security: securityPlugin,
    },
    rules: {
      // ── TypeScript hardening ──────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // ── Security ──────────────────────────────────────────────────────────
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-unsafe-regex': 'warn',
      'security/detect-pseudoRandomBytes': 'error',

      // ── General ───────────────────────────────────────────────────────────
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/**'],
              importNames: ['*'],
              // SECURITY: enforce `import 'server-only'` on db usage
              message:
                'Import @nexushub/db only in server contexts. Add "import \'server-only\';" at top of file.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='prisma'][callee.property.name='$queryRawUnsafe']",
          message: 'Raw SQL is forbidden. Use Prisma typed queries.',
        },
      ],
    },
  },
  {
    // SECURITY: relax non-null assertion + allow `any` in test files only.
    // Placed last so it overrides the strict rules above for these files.
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
