import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // 성능 측정은 pnpm test:perf(playwright.perf.config.ts)로 따로 돈다.
  testIgnore: '**/perf.e2e.ts',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/globalSetup.ts',
});
