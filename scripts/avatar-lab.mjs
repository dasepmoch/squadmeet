// Avatar contact sheets for self-critique:
//   node scripts/avatar-lab.mjs [baseUrl] [outFile] [patchesJson] [views]
// Each patch is applied to the local avatar spec; every view is photographed with a fixed camera
// and the shots are composited into one labelled grid (rows = patches, columns = views).
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const [
  base = 'http://localhost:5173/',
  outFile = 'screenshots/avatar-lab/sheet.png',
  patchesJson = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => ({ hairStyle: h }))),
  viewList = 'face,three,side,back',
] = process.argv.slice(2);
const patches = JSON.parse(patchesJson);
const views = viewList.split(',');
await mkdir(dirname(outFile), { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
await page.goto(`${base}?debug=1&offline=1&screen=idle`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 90000 });
await page.evaluate(() => window.__huddle.quality('high'));
await page.waitForFunction(() => window.__huddle.avatarReady(), null, { timeout: 60000 });
const X = 4.2;
const Z = 3.4;
await page.evaluate(([x, z]) => window.__huddle.teleport(x, z, 0), [X, Z]);
await page.waitForTimeout(800);

// The avatar faces +Z. Camera poses: [position, target, fov].
const H = 1.53;
const POSES = {
  face: [[X, H + 0.03, Z + 1.0], [X, H, Z], 30],
  three: [[X + 0.72, H + 0.05, Z + 0.72], [X, H, Z], 30],
  side: [[X + 1.0, H + 0.02, Z], [X, H, Z], 30],
  back: [[X - 0.38, H + 0.14, Z - 0.92], [X, H, Z], 30],
  top: [[X, H + 0.8, Z + 0.5], [X, H + 0.05, Z], 30],
  body: [[X + 0.9, 1.05, Z + 2.6], [X, 0.88, Z], 38],
  bodySide: [[X + 2.7, 1.05, Z + 0.3], [X, 0.88, Z], 38],
  bodyBack: [[X - 0.9, 1.05, Z - 2.6], [X, 0.88, Z], 38],
};

const shots = [];
for (const patch of patches) {
  const key = await page.evaluate((p) => window.__huddle.avatar(p, true), patch);
  await page.waitForFunction((k) => window.__huddle.avatarKey() === k, key, { timeout: 60000 });
  await page.waitForTimeout(700);
  const row = [];
  for (const v of views) {
    const [pos, target, fov] = POSES[v] ?? POSES.face;
    await page.evaluate(([p, t, f]) => window.__huddle.photo(p, t, f), [pos, target, fov]);
    await page.waitForTimeout(450);
    row.push((await page.screenshot({ type: 'jpeg', quality: 88 })).toString('base64'));
  }
  shots.push({ label: JSON.stringify(patch), row });
}

// Sheets of at most ROWS rows each (big sheets get downscaled too much to judge details).
const ROWS = Number(process.env.ROWS ?? 4);
const cell = Math.max(220, Math.floor(1500 / views.length));
const sheet = await browser.newPage({ viewport: { width: cell * views.length, height: 400 } });
for (let i = 0; i < shots.length; i += ROWS) {
  const part = shots.slice(i, i + ROWS);
  const html = `<html><body style="margin:0;background:#111;font:12px system-ui;color:#ddd">${part
    .map(
      (s) =>
        `<div style="display:flex;position:relative">${s.row.map((b) => `<img src="data:image/jpeg;base64,${b}" style="width:${cell}px;height:${cell}px;object-fit:cover">`).join('')}<span style="position:absolute;left:6px;top:4px;background:#000a;padding:2px 6px">${s.label}</span></div>`,
    )
    .join('')}</body></html>`;
  await sheet.setContent(html, { waitUntil: 'load' });
  const file = shots.length > ROWS ? outFile.replace(/\.png$/, `-${i / ROWS + 1}.png`) : outFile;
  await sheet.screenshot({ path: file, fullPage: true });
  console.log(`wrote ${file} (${part.length} rows x ${views.length} views)`);
}
console.log(logs.slice(-20).join('\n'));
await browser.close();
