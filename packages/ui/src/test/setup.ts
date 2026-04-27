import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// With Vitest's `globals: false` mode, RTL's auto-cleanup hook does not run.
// Register it explicitly so the DOM is wiped between tests.
afterEach(() => {
  cleanup();
});
