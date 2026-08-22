import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    exclude: ['node_modules', 'dist'],
    // better-sqlite3 is not thread-safe; run tests in isolated
    // child processes instead of worker threads to avoid crashes.
    pool: 'forks',
  },
});
