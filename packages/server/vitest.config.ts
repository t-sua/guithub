import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the core package to its TypeScript source rather than its build
      // output. Without this the server tests depend on `packages/core/dist`
      // existing, so a fresh clone fails at resolution before a single test runs.
      // The published entry point is still exercised by `npm run build`.
      '@guithub/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000
  }
});
