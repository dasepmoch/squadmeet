// Tiles screenshots into one labelled sheet: node scripts/contact-sheet.mjs out.png cols a.png b.png ...
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { chromium } from '@playwright/test';

const [outFile, colsArg, ...files] = process.argv.slice(2);
if (!outFile || !colsArg || files.length === 0) {
  console.error('usage: contact-sheet.mjs out.png cols a.png b.png ...');
  process.exit(1);
}
const cols = Number(colsArg);
const width = 1500;
const cell = Math.floor(width / cols);
const images = await Promise.all(
  files.map(async (f) => ({ name: basename(f), data: (await readFile(f)).toString('base64') })),
);
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width, height: 400 } });
const html = `<html><body style="margin:0;background:#111;font:12px system-ui;color:#eee;display:flex;flex-wrap:wrap;width:${width}px">${images
  .map(
    (im) =>
      `<div style="position:relative;width:${cell}px"><img src="data:image/png;base64,${im.data}" style="width:100%;display:block"><span style="position:absolute;left:6px;top:4px;background:#000a;padding:2px 6px">${im.name}</span></div>`,
  )
  .join('')}</body></html>`;
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: outFile, fullPage: true });
await browser.close();
console.log(`wrote ${outFile}`);
