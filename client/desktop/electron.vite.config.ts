import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig(({ mode }) => ({
  main: {
    // @btterm/core는 TS 소스라 번들한다. ssh2만 런타임 외부 모듈로 남는다(AGENTS §7).
    build: { externalizeDeps: { exclude: ['@btterm/core'] } },
  },
  preload: {
    // sandbox preload는 require할 수 있는 모듈이 제한되므로 전부 번들한다.
    build: { externalizeDeps: false },
  },
  renderer: {
    plugins: [react()],
    define: {
      // E2E 빌드에서만 버퍼 읽기 훅을 켠다. 출시 빌드에서는 상수 false로 제거된다.
      __BTTERM_E2E__: JSON.stringify(mode === 'e2e'),
    },
  },
}));
