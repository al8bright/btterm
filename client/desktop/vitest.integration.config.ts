import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./test/integration/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
