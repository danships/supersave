import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    exclude: ['node_modules', 'dist'],
    // better-sqlite3 is not thread-safe; run tests in isolated
    // child processes instead of worker threads to avoid crashes.
    pool: 'forks',
    // Vitest 4's forks pool can spawn multiple workers even when file
    // parallelism is disabled via the CLI flag, which crashes native
    // addons like better-sqlite3 on CI. Force a single fork/worker so
    // all test files run sequentially in the same child process.
    fileParallelism: false,
    maxForks: 1,
    minForks: 1,
  },
});
