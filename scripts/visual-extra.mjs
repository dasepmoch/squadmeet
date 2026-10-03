// Extra checks: walk cycle, seated pose (free look) and seat hover marker.
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [base = 'http://localhost:5173/', outDir = 'screenshots/extra'] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?debug=1&offline=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 60000 });
await page.waitForTimeout(1200);

// Walk cycle: side view while holding W.
await page.evaluate(() => {
  window.__huddle.teleport(-3, 6.5, Math.PI);
  window.__huddle.look(Math.PI / 2 + 0.25, 0.12, 3.2);
});
await page.waitForTimeout(600);
await page.mouse.move(800, 450);
await page.keyboard.down('KeyD');
await page.waitForTimeout(650);
await page.screenshot({ path: `${outDir}/walk.png` });
await page.keyboard.up('KeyD');

// Seated pose from free look.
await page.evaluate(() => {
  window.__huddle.teleport(-1.8, -1.9, Math.PI);
  window.__huddle.sit('lc-4.0');
});
await page.waitForTimeout(2500);
await page.keyboard.press('KeyF');
await page.waitForTimeout(400);
await page.evaluate(() => window.__huddle.look(0.5, 0.35, 2.4));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/seated-free.png` });

// Hover marker over a free seat.
await page.evaluate(() => {
  window.__huddle.stand();
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  window.__huddle.teleport(0, 3.2, Math.PI);
  window.__huddle.look(Math.PI, 0.35, 4.2);
});
await page.waitForTimeout(1200);
// Sweep across the tier seats (sofa cushions sit around y = 415 in this framing).
for (let x = 600; x <= 1040; x += 20) {
  await page.mouse.move(x, 415);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/hover.png` });
console.log(logs.join('\n'));
await browser.close();
