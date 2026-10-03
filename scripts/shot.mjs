// Quick visual check used during development: node scripts/shot.mjs <url> <out.png> [waitMs] [keys]
// Uses the locally installed Google Chrome (GPU-backed WebGL) through Playwright.
import { chromium } from '@playwright/test';

const [url = 'http://localhost:5173/', out = 'screenshots/shot.png', waitMs = '2500', keys = ''] =
  process.argv.slice(2);

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(waitMs));
for (const step of keys.split(',').filter(Boolean)) {
  const [key, ms = '500'] = step.split(':');
  await page.keyboard.down(key);
  await page.waitForTimeout(Number(ms));
  await page.keyboard.up(key);
}
if (keys) await page.waitForTimeout(400);
await page.screenshot({ path: out });
console.log(logs.slice(-30).join('\n'));
await browser.close();
