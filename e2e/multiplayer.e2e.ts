import { expect, test, type Browser, type Page } from '@playwright/test';

/** The `?debug=1` hooks the app installs (see apps/web/src/app/debug-hooks.ts). */
interface Hooks {
  ready: boolean;
  quality(level: 'low'): void;
  join(room: string, name: string): void;
  net(): { state: string; self: string | null; room: string | null; people: number };
  players(): {
    id: string;
    name: string;
    seat: string | null;
    hand: boolean;
    x: number;
    z: number;
  }[];
  seats(): string[];
  sit(seatId: string): void;
  chat(text: string): void;
  emote(id: string): void;
  hand(raised?: boolean): void;
}

interface AppHandle {
  store: { getState(): { chat: { name: string; text: string }[] } };
  sim: { view: { findPlayer(id: string): { action: string | null } | undefined } };
}

declare global {
  interface Window {
    __huddle?: Hooks;
    __huddleApp?: unknown;
  }
}

const SOFTWARE = process.env.E2E_GPU === 'swiftshader' || process.platform !== 'darwin';

// Callbacks passed to `page.evaluate` run in the browser, so each one reads the hooks itself.

async function openClient(browser: Browser): Promise<Page> {
  // Separate contexts: separate people (no shared storage).
  const page = await (await browser.newContext()).newPage();
  // Software WebGL needs seconds per frame: CI only checks the multiplayer state, not pixels.
  await page.goto(`/?debug=1&screen=idle${process.env.CI || SOFTWARE ? '&render=0' : ''}`);
  await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 120_000 });
  await page.evaluate(() => (window.__huddle as Hooks).quality('low'));
  return page;
}

const players = (page: Page) => page.evaluate(() => (window.__huddle as Hooks).players());
const netState = (page: Page) => page.evaluate(() => (window.__huddle as Hooks).net());
const seenBy = async (page: Page, id: string | null) =>
  (await players(page)).find((p) => p.id === id);
const chatOf = (page: Page) =>
  page.evaluate(() =>
    (window.__huddleApp as AppHandle).store.getState().chat.map((m) => `${m.name}: ${m.text}`),
  );
const actionOf = (page: Page, id: string | null) =>
  page.evaluate(
    (who) => (window.__huddleApp as AppHandle).sim.view.findPlayer(who ?? '')?.action ?? null,
    id,
  );

test('three people see each other move, sit, chat and emote', async ({ browser }) => {
  const room = `E2E${Math.floor(1000 + Math.random() * 9000)}`;

  // The first person uses the real lobby: code on the landing, name in the green room.
  const ana = await openClient(browser);
  await ana.getByLabel('Room code').fill(room);
  await ana.getByRole('button', { name: 'Join', exact: true }).click();
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join room' }).click();
  await expect.poll(async () => (await netState(ana)).state).toBe('joined');
  await expect(ana.getByRole('button', { name: new RegExp(`room ${room}`) })).toBeVisible();

  const budi = await openClient(browser);
  const cici = await openClient(browser);
  for (const [page, name] of [
    [budi, 'Budi'],
    [cici, 'Cici'],
  ] as const) {
    await page.evaluate(([r, n]) => (window.__huddle as Hooks).join(r, n), [room, name]);
    await expect.poll(async () => (await netState(page)).state).toBe('joined');
  }
  for (const page of [ana, budi, cici]) {
    await expect.poll(async () => (await players(page)).length).toBe(3);
  }
  const anaId = (await netState(ana)).self;
  const budiId = (await netState(budi)).self;
  expect(anaId).toBeTruthy();

  // Ana walks forward; Budi sees her get there.
  const start = await seenBy(budi, anaId);
  await ana.bringToFront();
  await ana.keyboard.down('KeyW');
  // Software rendering in CI is slow, and the simulation never runs more than 5 steps a frame.
  await ana.waitForTimeout(2000);
  await ana.keyboard.up('KeyW');
  await expect
    .poll(async () => {
      const now = await seenBy(budi, anaId);
      return start && now ? Math.hypot(now.x - start.x, now.z - start.z) : 0;
    })
    .toBeGreaterThan(0.8);

  // Budi takes a seat (walking there if needed); Cici sees him seated.
  const seat = await budi.evaluate(() => (window.__huddle as Hooks).seats()[0] ?? '');
  await budi.evaluate((s) => (window.__huddle as Hooks).sit(s), seat);
  await expect.poll(async () => (await seenBy(cici, budiId))?.seat ?? null).toBe(seat);

  // Cici says hi and everyone reads it; Ana waves and raises a hand, and Cici sees both.
  await cici.evaluate(() => (window.__huddle as Hooks).chat('Halo semua!'));
  for (const page of [ana, budi]) {
    await expect.poll(() => chatOf(page)).toContain('Cici: Halo semua!');
  }
  await ana.evaluate(() => {
    const h = window.__huddle as Hooks;
    h.emote('wave');
    h.hand(true);
  });
  await expect.poll(async () => (await seenBy(cici, anaId))?.hand ?? false).toBe(true);
  await expect.poll(() => actionOf(cici, anaId)).toBe('wave');

  await ana.context().close();
  await budi.context().close();
  await cici.context().close();
});
