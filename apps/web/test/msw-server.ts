import { setupServer } from 'msw/node';

// Add per-test handlers via server.use(...) inside individual test files.
export const server = setupServer();
