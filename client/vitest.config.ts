import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'core',
      'ui',
      'desktop/vitest.config.ts',
      'desktop/vitest.integration.config.ts',
      // 배포·검사 스크립트의 순수 함수(scripts/lib)
      { test: { name: 'scripts', include: ['scripts/**/*.test.mjs'], environment: 'node' } },
    ],
  },
});
