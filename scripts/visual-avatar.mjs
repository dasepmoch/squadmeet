// Avatar self-critique shots: node scripts/visual-avatar.mjs [baseUrl] [outDir] [quality]
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [base = 'http://localhost:5173/', outDir = 'screenshots/avatar', quality = 'high'] =
  process.argv.slice(2);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?debug=1&offline=1&screen=idle`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 90000 });
await page.evaluate((q) => window.__huddle.quality(q), quality);
await page.waitForFunction(() => window.__huddle.avatarReady(), null, { timeout: 60000 });
await page.evaluate(() => {
  window.__huddle.teleport(4.2, 3.4, 0);
  window.__huddle.camera('follow');
});
await page.waitForTimeout(1200);

// Camera yaw = direction the camera looks; the avatar faces +Z (yaw 0) here.
const views = [
  ['front', Math.PI, 0.12, 2.3],
  ['three-quarter', Math.PI - 0.7, 0.1, 2.1],
  ['side', Math.PI / 2 + Math.PI, 0.08, 2.1],
  ['back', 0, 0.15, 2.3],
  ['face', Math.PI - 0.25, 0.02, 0.95],
  ['face-side', Math.PI - 1.1, 0.02, 0.9],
];
for (const [name, yaw, pitch, dist] of views) {
  await page.evaluate(([y, p, d]) => window.__huddle.look(y, p, d), [yaw, pitch, dist]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${name}.png` });
}
await page.evaluate(() => {
  window.__huddle.look(Math.PI - 0.3, 0.1, 2.4);
  window.__huddle.emote('wave');
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/wave.png` });
await page.evaluate(() => window.__huddle.emote('cheer'));
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/cheer.png` });
await page.evaluate(() => {
  window.__huddle.teleport(-2.1, -0.4, Math.PI / 2);
  window.__huddle.sit('chair-w3.0');
});
await page.waitForTimeout(3200);
await page.evaluate(() => {
  window.__huddle.camera('seatedFree');
  window.__huddle.look(-Math.PI / 2 + 0.35, 0.15, 1.9);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/seated.png` });
const stats = await page.evaluate(() => window.__huddle.stats());
console.log(JSON.stringify(stats));
console.log(
  logs
    .filter((l) => !l.includes('[vite]'))
    .slice(-25)
    .join('\n'),
);
await browser.close();
