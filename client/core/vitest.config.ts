import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/testing/setup.ts'],
  },
});
