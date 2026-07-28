import type { Preview } from '@storybook/nextjs-vite';
// Design tokens + shared component styles (Tailwind v4 + @nexushub/ui
// tokens.css/components.css) — same import chain as app/layout.tsx, so
// stories render with the real design system, not bare HTML.
import '../styles/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // NexusHub components are styled against the app's own background token
    // (not white) — render stories on it instead of Storybook's default.
    backgrounds: {
      options: {
        app: { name: 'App', value: 'var(--color-bg-app)' },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'app' },
  },
};

export default preview;
