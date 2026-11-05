import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: process.cwd(),
    include: ['test/**/*.integration.ts'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
