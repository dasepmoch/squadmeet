// Social features tour for self-critique: bots, HUD, throwing, splats, emotes, chat, board,
// theater and the avatar editor.
//   node scripts/visual-social.mjs [baseUrl] [outDir]
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [base = 'http://localhost:5173/', outDir = 'screenshots/social-v1'] = process.argv.slice(2);
const QUALITY = process.env.QUALITY ?? 'medium';
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`shot ${name}`);
};
const wait = (ms) => page.waitForTimeout(ms);
const hud = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${base}?debug=1&offline=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 90000 });
await hud((q) => window.__huddle.quality(q), QUALITY);
const events = [];
await page.exposeFunction('__logEvent', (e) => events.push(e));
await hud(() => {
  const sim = window.__huddleApp.sim;
  sim.events.on('projectile', (e) =>
    window.__logEvent(`${e.type}:${e.kind}:${e.throwerId}->${e.targetId ?? '-'}`),
  );
});
await page.waitForFunction(() => window.__huddle.players().length > 1, null, { timeout: 30000 });
await page.waitForFunction(
  () => window.__huddle.avatarsReady() >= window.__huddle.players().length,
  null,
  { timeout: 90000 },
);
await wait(2500);
await page.mouse.move(720, 300);
await shot('01-arrive');

await hud(() => window.__huddle.camera('overview'));
await wait(1600);
await shot('02-overview');

// Stand south of the table looking north, a few office-mates in view.
await hud(() => {
  window.__huddle.camera('follow');
  window.__huddle.teleport(0.6, 3.6, Math.PI);
  window.__huddle.look(Math.PI, 0.32, 3.4);
});
await wait(1500);

/** Screen point of a player's chest (CSS px) from the last rendered camera. */
const chestOf = (id) =>
  hud((pid) => {
    const app = window.__huddleApp;
    const p = app.sim.view.findPlayer(pid);
    const out = { x: 0, y: 0, depth: 0 };
    const seated = p.sitBlend > 0.5;
    const ok = app.renderer.project(
      { x: p.position.x, y: p.position.y + (seated ? 0.45 : 1.15), z: p.position.z },
      out,
    );
    return ok ? out : null;
  }, id);
const target = await hud(() => {
  const app = window.__huddleApp;
  const cam = app.sim.view.camera.position;
  const bots = app.sim.view.players.filter((p) => p.isBot);
  bots.sort(
    (a, b) =>
      Math.hypot(a.position.x - cam.x, a.position.z - cam.z) -
      Math.hypot(b.position.x - cam.x, b.position.z - cam.z),
  );
  return bots[0]?.id ?? null;
});
const at = target ? await chestOf(target) : null;
console.log('target', target, at);
await hud(() => window.__huddle.aim('tomato'));
if (at) await page.mouse.move(at.x, at.y, { steps: 6 });
await wait(400);
await shot('03-aim');
await page.mouse.down();
await page.mouse.up();
await wait(420);
await shot('04-throw');
await wait(900);
await shot('05-hit');
console.log('hover after hit', await hud(() => window.__huddle.hover()));

// Tomato on the east wall, seen up close.
await hud(() => {
  window.__huddle.aim(null);
  window.__huddle.teleport(5.2, 1.0, Math.PI / 2);
});
await wait(600);
const thrown = await hud(() => [window.__huddle.throw('tomato', 7.95, 1.5, 0.6)]);
console.log('wall throw', thrown);
await wait(1400);
await hud(() => window.__huddle.throw('tomato', 7.95, 1.2, 1.4));
await wait(1400);
await hud(() => window.__huddle.photo([5.0, 1.55, 1.0], [8, 1.35, 1.0], 48));
await wait(500);
await shot('06-splat');

// Confetti over the table.
await hud(() => {
  window.__huddle.camera('follow');
  window.__huddle.teleport(0.6, 3.6, Math.PI);
  window.__huddle.look(Math.PI, 0.28, 3.4);
});
await wait(1200);
await hud(() => window.__huddle.throw('confetti', 0.4, 1.2, -0.6));
await wait(1050);
await shot('07-confetti');
await wait(900);
console.log('heart thrown', await hud(() => window.__huddle.throw('heart', -0.6, 1.4, -0.4)));
await wait(1150);
await shot('08-hearts');

// Emote wheel.
await page.keyboard.press('KeyQ');
await wait(500);
await page.mouse.move(720 + 120, 420);
await wait(300);
await shot('09-wheel');
await page.keyboard.press('Escape');
await wait(300);

// Chat with a reply.
await page.keyboard.press('Enter');
await wait(400);
const botName = await hud(() => window.__huddle.players().find((p) => p.bot)?.name ?? 'Raka');
await page.keyboard.type(`Halo ${botName}, siap rapat?`);
await page.keyboard.press('Enter');
await wait(3600);
await shot('10-chat');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(300);

// People panel + raised hand.
await hud(() => {
  window.__huddle.hand(true);
  window.__huddleApp.store.setState({ panel: 'people' });
});
await wait(900);
await hud(() => window.__huddle.photo([0.6, 1.7, 1.4], [0.6, 1.5, 3.6], 42));
await wait(1500);
await shot('11-hand-people');
await hud(() => {
  window.__huddle.hand(false);
  window.__huddleApp.store.setState({ panel: null });
  window.__huddle.camera('follow');
});

// Whiteboard.
await hud(() => window.__huddle.board(true));
await wait(1400);
await page.mouse.move(560, 380);
await page.mouse.down();
for (let i = 0; i <= 40; i++)
  await page.mouse.move(560 + i * 9, 380 + Math.sin(i / 4) * 60, { steps: 1 });
await page.mouse.up();
await page.mouse.move(600, 560);
await page.mouse.down();
await page.mouse.move(900, 560, { steps: 20 });
await page.mouse.up();
await wait(300);
await shot('12-board');
await hud(() => window.__huddle.board(false));
await wait(800);

// Theater mode.
await hud(() => window.__huddle.theater(true));
await wait(1200);
await shot('13-theater');
await hud(() => window.__huddle.theater(false));
await wait(400);

// Avatar editor.
await hud(() => window.__huddleApp.openAvatarEditor(true));
await wait(3500);
await shot('14-editor');
await hud(() => window.__huddleApp.openAvatarEditor(false));
await wait(400);

// Help panel over the room.
await hud(() => window.__huddleApp.store.setState({ panel: 'help' }));
await wait(500);
await shot('15-help');
await hud(() => window.__huddleApp.store.setState({ panel: null }));

console.log('local events', events.filter((e) => e.includes('local')).join(' | '));
console.log('stats', JSON.stringify(await hud(() => window.__huddle.stats())));
console.log('fx', JSON.stringify(await hud(() => window.__huddle.fx())));
console.log('players', JSON.stringify(await hud(() => window.__huddle.players())));
console.log(logs.slice(-30).join('\n'));
await browser.close();
