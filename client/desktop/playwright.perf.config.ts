import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// 성능 측정(PRD §7, AC17). 부하·장비에 민감해 기본 E2E와 분리한다: pnpm test:perf
export default defineConfig({
  ...base,
  testMatch: '**/perf.e2e.ts',
  testIgnore: [],
});
