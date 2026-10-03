// Close-up turntable of the local avatar's head: node scripts/avatar-head.mjs [baseUrl] [outDir]
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [base = 'http://localhost:5173/', outDir = 'screenshots/head'] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?debug=1&offline=1&screen=idle`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 60000 });
await page.evaluate(() => window.__huddle.quality('high'));
await page.evaluate(() => window.__huddle.teleport(-2.2, 4.6, Math.PI));
await page.waitForTimeout(1500);

// Camera yaw is the look direction; the avatar faces -Z, so yaw 0 looks at the face.
const angles = [
  ['front', 0],
  ['three-quarter', 0.75],
  ['side', Math.PI / 2],
  ['back-three-quarter', Math.PI - 0.7],
  ['back', Math.PI],
];
for (const [name, yaw] of angles) {
  await page.evaluate((y) => window.__huddle.look(y, 0.06, 1.05), yaw);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${name}.png` });
}
console.log(logs.join('\n'));
await browser.close();
