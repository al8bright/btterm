// 프로세스·패키지 경계(AGENTS.md §3). `pnpm lint:deps`가 이 규칙으로 import 그래프를 검사한다.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-is-pure',
      comment: 'core는 앱·UI 코드를 import하지 않는다',
      severity: 'error',
      from: { path: '^core/src' },
      to: { path: '^(client/desktop/|ui/)' },
    },
    {
      name: 'ssh2-only-in-session-host',
      comment: 'ssh2는 session host(utilityProcess)에서만 로드한다',
      severity: 'error',
      from: { path: '^desktop/src', pathNot: '^desktop/src/session-host' },
      to: { path: 'node_modules/ssh2/' },
    },
    {
      name: 'renderer-isolated',
      comment: 'renderer는 main·preload·session-host·platform·Node 내장 모듈을 import하지 않는다',
      severity: 'error',
      from: { path: '^(client/desktop/src/renderer|ui/src)' },
      to: {
        path: ['^desktop/src/(main|preload|session-host|platform)', '^electron$'],
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'renderer-no-node-builtins',
      severity: 'error',
      from: { path: '^(client/desktop/src/renderer|ui/src)' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'preload-isolated',
      comment: 'preload는 main·session-host를 import하지 않는다',
      severity: 'error',
      from: { path: '^desktop/src/preload' },
      to: { path: '^desktop/src/(main|session-host|platform)' },
    },
    {
      name: 'main-not-session-host',
      comment: 'main은 session host 코드를 직접 import하지 않는다(?modulePath 진입점만)',
      severity: 'error',
      from: { path: '^desktop/src/main' },
      to: {
        path: '^desktop/src/session-host',
        pathNot: '^desktop/src/session-host/index\\.ts$',
      },
    },
    {
      name: 'session-host-not-main',
      severity: 'error',
      from: { path: '^desktop/src/session-host' },
      to: { path: '^desktop/src/(main|preload|renderer)' },
    },
    {
      name: 'no-spikes',
      comment: 'spikes는 버리는 코드다',
      severity: 'error',
      from: { pathNot: '^spikes/' },
      to: { path: '^spikes/' },
    },
    {
      name: 'no-testing-in-production',
      comment: '@btterm/core/testing은 테스트에서만',
      severity: 'error',
      from: {
        path: '^(core|ui|desktop)/src',
        pathNot: '\\.(test|int\\.test)\\.tsx?$|/testing/',
      },
      to: { path: '^core/src/testing' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(out|release|dist|node_modules)/' },
    tsPreCompilationDeps: true,
    // 경로 별칭이 없어 tsconfig 연동 없이 확장자 해석만 한다.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.d.ts'],
    },
  },
};
