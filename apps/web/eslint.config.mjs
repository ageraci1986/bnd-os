import rootConfig from '../../eslint.config.mjs';
import nextPlugin from '@next/eslint-plugin-next';

export default [
  ...rootConfig,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    rules: {
      // SECURITY: disallow accessing Node-only secrets from client components
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Use lib/env.ts (getServerEnv / getPublicEnv). Direct process.env access is forbidden.',
        },
      ],
    },
  },
];
