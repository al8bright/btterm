import { defineProject } from 'vitest/config';

export default defineProject({
  define: { __BTTERM_E2E__: 'false' },
  test: {
    name: 'ui',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/testing/setup.ts'],
  },
});
