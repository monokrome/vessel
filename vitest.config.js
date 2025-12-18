import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/ui/**', 'jsdom'],
    ],
    setupFiles: ['tests/mocks/setup.js'],
  },
});
