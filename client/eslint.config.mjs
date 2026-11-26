import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import globals from 'globals';

// AGENTS.md §3: core는 외부 세계(Node·Electron·DOM·React·ssh2)를 import하지 않는다.
const coreRestrictedImports = {
  patterns: [
    { group: ['node:*'], message: 'core는 Node API를 쓰지 않는다(AGENTS §3). 포트로 주입하라.' },
    {
      group: [
        'fs',
        'path',
        'os',
        'crypto',
        'net',
        'child_process',
        'electron',
        'react',
        'react-dom',
        'ssh2',
        'node-pty',
      ],
      message: 'core는 외부 런타임 모듈을 import하지 않는다(AGENTS §3).',
    },
  ],
};

// AGENTS.md §3: 시간·난수는 Clock·IdGenerator 포트로만.
const coreRestrictedGlobals = [
  { name: 'setTimeout', message: 'Clock 포트를 쓴다(AGENTS §3).' },
  { name: 'setInterval', message: 'Clock 포트를 쓴다(AGENTS §3).' },
  { name: 'clearTimeout', message: 'Clock 포트를 쓴다(AGENTS §3).' },
  { name: 'clearInterval', message: 'Clock 포트를 쓴다(AGENTS §3).' },
  { name: 'setImmediate', message: 'Clock 포트를 쓴다(AGENTS §3).' },
  { name: 'process', message: 'core는 process에 접근하지 않는다(AGENTS §3).' },
  { name: 'window', message: 'core는 DOM에 접근하지 않는다(AGENTS §3).' },
  { name: 'document', message: 'core는 DOM에 접근하지 않는다(AGENTS §3).' },
];

const coreRestrictedProperties = [
  { object: 'Date', property: 'now', message: 'Clock 포트를 쓴다(AGENTS §3).' },
  { object: 'Math', property: 'random', message: 'IdGenerator 포트를 쓴다(AGENTS §3).' },
  { object: 'crypto', property: 'randomUUID', message: 'IdGenerator 포트를 쓴다(AGENTS §3).' },
];

const osImportRestrictions = [
  { name: 'node:os', message: 'OS 정보·경로는 src/platform에서만(AGENTS §3).' },
  { name: 'os', message: 'OS 정보·경로는 src/platform에서만(AGENTS §3).' },
];

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', 'docs/mockup/**', 'spikes/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['core/src/**/*.ts'],
    ignores: ['core/src/**/*.test.ts', 'core/src/testing/**'],
    rules: {
      'no-restricted-imports': ['error', coreRestrictedImports],
      'no-restricted-globals': ['error', ...coreRestrictedGlobals],
      'no-restricted-properties': ['error', ...coreRestrictedProperties],
    },
  },
  {
    // AGENTS.md §3: OS 분기·OS 경로는 platform 어댑터 안에서만.
    files: ['desktop/src/**/*.{ts,tsx}'],
    ignores: ['desktop/src/platform/**', '**/*.test.ts', '**/*.int.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'platform',
          message: 'OS 분기는 src/platform에서만(AGENTS §3).',
        },
        { object: 'os', property: 'platform', message: 'OS 분기는 src/platform에서만(AGENTS §3).' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...osImportRestrictions,
            {
              name: 'electron',
              importNames: ['shell'],
              message: '외부 열기는 main/external/openExternal.ts에서만(SEC-6).',
            },
            {
              name: 'electron',
              importNames: ['crashReporter'],
              message: '크래시 리포트 자동 업로드 금지(SEC-13).',
            },
          ],
        },
      ],
    },
  },
  {
    // SEC-6: shell.openExternal 모듈만 electron shell을 쓸 수 있다(위 블록의 shell 제한을 해제).
    files: ['desktop/src/main/external/openExternal.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: osImportRestrictions }],
    },
  },
  {
    // AGENTS.md §8: 화면 문자열은 i18n 키로. JSX 텍스트와 접근성 속성의 리터럴을 막는다.
    files: ['desktop/src/renderer/**/*.tsx', 'ui/src/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/[A-Za-z가-힣]/]',
          message: '화면 문자열은 t(키)로(AGENTS §8).',
        },
        {
          selector:
            'JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=/[A-Za-z가-힣]/]',
          message: '접근성·안내 문자열은 t(키)로(AGENTS §8).',
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    plugins: { vitest },
    rules: {
      // AGENTS.md §6: 조용한 skip·only·todo 금지.
      'vitest/no-disabled-tests': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-commented-out-tests': 'error',
      'vitest/warn-todo': 'error',
    },
  },
);
