import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.integration.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
