// Self-critique screenshots: node scripts/visual.mjs [baseUrl] [outDir] [quality]
// Uses the locally installed Google Chrome (GPU-backed WebGL) and the ?debug=1 hooks.
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [base = 'http://localhost:5173/', outDir = 'screenshots', quality = 'high'] =
  process.argv.slice(2);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: true,
  args: [
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?debug=1&offline=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 60000 });
await page.evaluate((q) => window.__huddle.quality(q), quality);
await page.waitForTimeout(1500);

const shots = [
  {
    name: 'overview',
    run: () => window.__huddle.camera('overview'),
  },
  {
    name: 'seated',
    run: () => {
      window.__huddle.camera('follow');
      window.__huddle.teleport(0.6, -1.9, Math.PI);
      window.__huddle.sit('lc-6.0');
    },
    wait: 3500,
  },
  {
    name: 'closeup',
    run: () => {
      window.__huddle.stand();
      window.__huddle.teleport(-2.5, 4.2, Math.PI);
      window.__huddle.camera('follow');
      window.__huddle.look(0.35, 0.12, 2.4);
    },
    wait: 2500,
  },
  {
    name: 'lounge',
    run: () => {
      window.__huddle.teleport(7.2, -2.2, -2.2);
      window.__huddle.look(-2.3, 0.28, 4.6);
    },
    wait: 2500,
  },
  {
    name: 'play',
    run: () => {
      window.__huddle.teleport(-7.5, 0.5, 2.3);
      window.__huddle.look(2.4, 0.3, 4.4);
    },
    wait: 2500,
  },
  {
    name: 'avatar-sun',
    run: () => {
      window.__huddle.teleport(-1.2, 6.0, 0.6);
      window.__huddle.look(Math.PI + 0.6, 0.22, 2.6);
    },
    wait: 2500,
  },
  {
    name: 'video-screen',
    run: () => window.__huddle.camera('focus'),
    wait: 2500,
  },
  {
    name: 'idle-screen',
    run: () => {
      window.__huddle.screen('idle');
      window.__huddle.camera('focus');
    },
    wait: 2500,
  },
];

for (const shot of shots) {
  await page.evaluate(shot.run);
  await page.waitForTimeout(shot.wait ?? 2000);
  await page.screenshot({ path: `${outDir}/${shot.name}.png` });
}
const stats = await page.evaluate(() => window.__huddle.stats());
console.log(JSON.stringify(stats));
console.log(
  logs
    .filter((l) => !l.includes('[vite]'))
    .slice(-40)
    .join('\n'),
);
await browser.close();
