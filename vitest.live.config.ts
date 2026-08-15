import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/domain/fees/live-fees.integration.ts'],
    testTimeout: 30_000,
  },
});
