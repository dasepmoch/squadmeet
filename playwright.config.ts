import { defineConfig } from '@playwright/test';
import { fakeVoiceFile } from './e2e/fake-voice.ts';

const PORT = Number(process.env.E2E_PORT ?? 8790);
const CHANNEL = process.env.PW_CHANNEL;
// No GPU in CI: SwiftShader gives every client a (slow, software) WebGL2 context.
// `E2E_GPU=swiftshader` forces that path locally too.
const SOFTWARE = process.env.E2E_GPU === 'swiftshader' || process.platform !== 'darwin';
const GPU_ARGS = SOFTWARE
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-angle=metal', '--ignore-gpu-blocklist'];
// Fake microphone (a voice-like WAV), screen capture without the picker, audio without a click.
const MEDIA_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${fakeVoiceFile()}`,
  '--auto-select-desktop-capture-source=Entire screen',
  '--autoplay-policy=no-user-gesture-required',
];
/**
 * End-to-end tests run against the production build served by the real server
 * (`pnpm build` first). `pnpm e2e` = the multiplayer and voice/share scenarios.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 960, height: 600 },
    locale: 'en-US',
    trace: 'retain-on-failure',
    launchOptions: { args: [...GPU_ARGS, ...MEDIA_ARGS] },
  },
  projects: [
    // `PW_CHANNEL=chrome` uses the installed Google Chrome instead of Playwright's Chromium.
    {
      name: 'e2e',
      testMatch: /.*\.e2e\.ts/,
      use: { browserName: 'chromium', ...(CHANNEL ? { channel: CHANNEL } : {}) },
    },
  ],
  webServer: {
    command: 'node apps/server/src/main.ts',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      HUDDLE_PORT: String(PORT),
      HUDDLE_HOST: '127.0.0.1',
      HUDDLE_STATIC_DIR: 'apps/web/dist',
      HUDDLE_LOG_LEVEL: 'warn',
    },
  },
});
