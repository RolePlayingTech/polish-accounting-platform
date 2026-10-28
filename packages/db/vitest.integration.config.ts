import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: process.cwd(),
    include: ['test/**/*.integration.ts'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
    hookTimeout: 30_000,
    // btree_gist jest rozszerzeniem na poziomie bazy; zestawy mają własne schematy,
    // ale instalację i usuwanie rozszerzenia muszą wykonywać kolejno.
    fileParallelism: false,
  },
});
