// Boardroom self-critique screenshots: node scripts/visual-room.mjs [baseUrl] [outDir] [quality] [only]
// Uses the locally installed Google Chrome (GPU-backed WebGL) and the ?debug=1 hooks.
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [base = 'http://localhost:5173/', outDir = 'screenshots/room', quality = 'high', only = ''] =
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
await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 90000 });
await page.evaluate((q) => window.__huddle.quality(q), quality);
await page.waitForTimeout(2000);

const shots = [
  { name: 'overview', run: () => window.__huddle.camera('overview') },
  {
    name: 'entrance',
    run: () => {
      window.__huddle.teleport(4.6, 4.4, -2.5);
      window.__huddle.camera('follow');
      window.__huddle.look(-2.35, 0.12, 3.2);
    },
  },
  {
    name: 'table',
    run: () => {
      window.__huddle.teleport(2.6, 3.6, -2.7);
      window.__huddle.look(-2.62, 0.2, 3.4);
    },
  },
  {
    name: 'seated',
    run: () => {
      window.__huddle.teleport(0, 4.3, Math.PI);
      window.__huddle.sit('chair-head.0');
    },
    wait: 3500,
  },
  {
    name: 'screen',
    run: () => {
      window.__huddle.stand();
      window.__huddle.camera('focus');
    },
  },
  {
    name: 'lounge',
    run: () => {
      window.__huddle.teleport(3.6, 2.6, 2.2);
      window.__huddle.camera('follow');
      window.__huddle.look(2.1, 0.18, 3.0);
    },
  },
  {
    name: 'coffee',
    run: () => {
      window.__huddle.teleport(-3.6, 2.4, -2.0);
      window.__huddle.look(-2.0, 0.16, 3.0);
    },
  },
  {
    name: 'presentation',
    run: () => {
      window.__huddle.lights('presentation');
      window.__huddle.teleport(0.6, 3.4, Math.PI);
      window.__huddle.look(Math.PI + 0.08, 0.16, 3.2);
    },
  },
  {
    name: 'party',
    run: () => {
      window.__huddle.lights('party');
      window.__huddle.teleport(0.6, 3.4, Math.PI);
      window.__huddle.look(Math.PI + 0.08, 0.3, 3.8);
    },
  },
];

for (const shot of shots) {
  if (only && !only.split(',').includes(shot.name)) continue;
  await page.evaluate(shot.run);
  await page.waitForTimeout(shot.wait ?? 2200);
  await page.screenshot({ path: `${outDir}/${shot.name}.png` });
}
await page.evaluate(() => window.__huddle.lights('meeting'));
const stats = await page.evaluate(() => window.__huddle.stats());
console.log(JSON.stringify(stats));
console.log(
  logs
    .filter((l) => !l.includes('[vite]'))
    .slice(-40)
    .join('\n'),
);
await browser.close();
