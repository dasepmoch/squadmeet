// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Globals that must only be touched inside platform-web (and the app composition roots). */
const PLATFORM_GLOBALS = [
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'Notification',
  'RTCPeerConnection',
  'AudioContext',
  'webkitAudioContext',
  'WebSocket',
  'Worker',
  'ResizeObserver',
  'matchMedia',
  'requestAnimationFrame',
  'cancelAnimationFrame',
].map((name) => ({ name, message: 'Use the injected platform service instead.' }));

/** Pure layers must be deterministic and runnable in Node: no DOM, no ambient timers. */
const DOM_GLOBALS = [
  'window',
  'document',
  'performance',
  'console',
  'fetch',
  'location',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
].map((name) => ({ name, message: 'engine/shared/net must stay platform-agnostic.' }));

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/.turbo/**',
    '**/coverage/**',
    'apps/desktop/src-tauri/target/**',
    'apps/desktop/src-tauri/gen/**',
    'test-results/**',
    'playwright-report/**',
    'screenshots/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.es2023 },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  // Pure layers: no DOM, no platform, no three.js.
  {
    files: ['packages/shared/src/**', 'packages/engine/src/**', 'packages/net/src/**'],
    rules: {
      'no-restricted-globals': ['error', ...PLATFORM_GLOBALS, ...DOM_GLOBALS],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'Rendering belongs in @huddle/render.' },
            { group: ['react', 'react-dom'], message: 'UI belongs in @huddle/ui.' },
            { group: ['@huddle/platform-web'], message: 'Use platform interfaces.' },
          ],
        },
      ],
    },
  },
  // Browser layers: DOM allowed, platform globals are not.
  {
    files: [
      'packages/render/src/**',
      'packages/rtc/src/**',
      'packages/ui/src/**',
      'packages/content/src/**',
    ],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-globals': ['error', ...PLATFORM_GLOBALS],
    },
  },
  {
    files: ['packages/platform-web/src/**', 'apps/web/src/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['apps/server/**', 'e2e/**', '*.config.ts', 'scripts/**'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    // Playwright helpers: `page.evaluate` callbacks run inside the browser page.
    files: ['scripts/**', 'e2e/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['packages/ui/src/**/*.tsx', 'packages/content/src/**/*.tsx', 'apps/web/src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'max-lines': 'off',
    },
  },
  prettier,
]);
