import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.spec.ts', 'tests/e2e/**'],
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
