import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'cli/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['src/**/*.performance.test.ts'],
  },
});
