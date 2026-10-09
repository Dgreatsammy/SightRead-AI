import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    // Parsing real scans is slow on modest machines (WSL, laptops, CI).
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});