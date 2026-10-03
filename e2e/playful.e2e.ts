import { expect, test, type Browser, type Page } from '@playwright/test';

/** The `?debug=1` hooks the app installs (see apps/web/src/app/debug-hooks.ts). */
interface Hooks {
  ready: boolean;
  quality(level: 'low'): void;
  join(room: string, name: string): void;
  net(): { state: string; self: string | null; room: string | null; people: number };
  players(): { id: string; name: string; x: number; z: number }[];
  teleport(x: number, z: number, yaw: number): void;
  throw(kind: string, x: number, y: number, z: number, targetId?: string): boolean;
  hold(item: string | null): void;
  shield(on: boolean): void;
  scores(): Record<string, number>;
  shootHoop(): boolean;
  clean(): void;
  fx(): { projectiles: number; particles: number; decals: number };
  play(): { held: string | null; shield: boolean; tilt: number; splats: number };
}

interface PlayerLook {
  held: string | null;
  shield: boolean;
  action: string | null;
}

/** The fields of projectile and action events the test records. */
interface SimEvent {
  type?: string;
  kind?: string;
  targetId?: string | null;
  playerId?: string;
  id?: string;
}

interface AppHandle {
  store: { getState(): { chat: { text: string }[]; toasts: { textKey: string }[] } };
  sim: {
    view: { findPlayer(id: string): PlayerLook | undefined };
    events: { on(type: string, fn: (e: SimEvent) => void): unknown };
  };
}

declare global {
  interface Window {
    __huddle?: Hooks;
    __huddleApp?: unknown;
    /** What happened on this client (projectile events, actions, toasts), recorded by the test. */
    __play?: string[];
  }
}

const SOFTWARE = process.env.E2E_GPU === 'swiftshader' || process.platform !== 'darwin';

// Callbacks passed to `page.evaluate` run in the browser, so each one reads the hooks itself.
const playersOf = (page: Page) => page.evaluate(() => (window.__huddle as Hooks).players());
const scoresOf = (page: Page) => page.evaluate(() => (window.__huddle as Hooks).scores());
const projectilesOf = (page: Page) =>
  page.evaluate(() => (window.__huddle as Hooks).fx().projectiles);
const splatsOf = (page: Page) => page.evaluate(() => (window.__huddle as Hooks).play().splats);

async function openClient(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  // Software WebGL needs seconds per frame: CI checks the shared state, not pixels.
  await page.goto(`/?debug=1&screen=idle${process.env.CI || SOFTWARE ? '&render=0' : ''}`);
  await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 120_000 });
  await page.evaluate(() => {
    (window.__huddle as Hooks).quality('low');
    const app = window.__huddleApp as AppHandle;
    const log: string[] = (window.__play = []);
    app.sim.events.on('projectile', (e) =>
      log.push(`${e.type ?? ''}:${e.kind ?? ''}:${e.targetId ?? ''}`),
    );
    app.sim.events.on('action', (e) => log.push(`action:${e.playerId ?? ''}:${e.id ?? ''}`));
  });
  return page;
}

async function join(page: Page, room: string, name: string): Promise<string> {
  await page.evaluate(([r, n]) => (window.__huddle as Hooks).join(r, n), [room, name]);
  await expect
    .poll(() => page.evaluate(() => (window.__huddle as Hooks).net().state))
    .toBe('joined');
  return (await page.evaluate(() => (window.__huddle as Hooks).net().self)) ?? '';
}

const played = (page: Page) => page.evaluate(() => window.__play ?? []);
const look = (page: Page, id: string) =>
  page.evaluate((who) => {
    const p = (window.__huddleApp as AppHandle).sim.view.findPlayer(who);
    return p ? { held: p.held, shield: p.shield, action: p.action } : null;
  }, id);
const toastKeys = (page: Page) =>
  page.evaluate(() =>
    (window.__huddleApp as AppHandle).store.getState().toasts.map((t) => t.textKey),
  );
const chatOf = (page: Page) =>
  page.evaluate(() => (window.__huddleApp as AppHandle).store.getState().chat.map((m) => m.text));

test('a tomato lands, a protected person is safe, baskets count everywhere, the host mops up', async ({
  browser,
}) => {
  const room = `PLAY${Math.floor(1000 + Math.random() * 9000)}`;
  const ana = await openClient(browser);
  const anaId = await join(ana, room, 'Ana');
  const budi = await openClient(browser);
  const budiId = await join(budi, room, 'Budi');
  for (const page of [ana, budi])
    await expect.poll(async () => (await playersOf(page)).length).toBe(2);

  // Ana stands by the hoop, Budi a couple of meters away.
  await ana.evaluate(() => (window.__huddle as Hooks).teleport(5.2, 3.7, Math.PI / 2));
  await budi.evaluate(() => (window.__huddle as Hooks).teleport(3.4, 5.0, Math.PI / 2));
  await expect
    .poll(async () => {
      const b = (await playersOf(ana)).find((p) => p.id === budiId);
      return b ? Math.hypot(b.x - 3.4, b.z - 5.0) : 99;
    })
    .toBeLessThan(0.3);

  // A tomato: Budi flinches and wipes his face, on his screen and on Ana's.
  expect(
    await ana.evaluate(
      (id) => (window.__huddle as Hooks).throw('tomato', 3.4, 1.2, 5.0, id),
      budiId,
    ),
  ).toBe(true);
  await expect.poll(() => played(budi)).toContain('action:local:wipe');
  await expect.poll(() => played(ana)).toContain(`hit:tomato:${budiId}`);
  await expect.poll(() => toastKeys(budi)).toContain('feed.hitYou');
  // Drawn clients also stick the splat to his shirt (or face).
  if (!process.env.CI && !SOFTWARE) await expect.poll(() => splatsOf(ana)).toBeGreaterThan(0);

  // Budi holds a mug of coffee; Ana sees it in his hand.
  await budi.evaluate(() => (window.__huddle as Hooks).hold('mug'));
  await expect.poll(async () => (await look(ana, budiId))?.held ?? null).toBe('mug');

  // "Don't hit me": the next one passes through him with a shimmer, and he cannot throw.
  await budi.evaluate(() => (window.__huddle as Hooks).shield(true));
  await expect.poll(async () => (await look(ana, budiId))?.shield ?? false).toBe(true);
  await ana.waitForTimeout(1200);
  expect(
    await ana.evaluate(
      (id) => (window.__huddle as Hooks).throw('paper', 3.4, 1.2, 5.0, id),
      budiId,
    ),
  ).toBe(true);
  await expect.poll(() => played(ana)).toContain(`ghost:paper:${budiId}`);
  await budi.waitForTimeout(1500);
  expect((await played(budi)).filter((e) => e === 'action:local:hit')).toHaveLength(0);
  expect(await budi.evaluate(() => (window.__huddle as Hooks).throw('paper', 5.2, 1.2, 3.7))).toBe(
    false,
  );
  await expect.poll(() => toastKeys(budi)).toContain('toast.shieldNoThrow');
  await budi.evaluate(() => (window.__huddle as Hooks).shield(false));
  await expect.poll(async () => (await look(ana, budiId))?.shield ?? true).toBe(false);

  // A basket from close range: two points, on both scoreboards.
  await ana.waitForTimeout(800);
  expect(await ana.evaluate(() => (window.__huddle as Hooks).shootHoop())).toBe(true);
  await expect.poll(async () => (await scoresOf(ana)).local ?? 0).toBe(2);
  await expect.poll(async () => (await scoresOf(budi))[anaId] ?? 0).toBe(2);
  await expect.poll(() => chatOf(budi)).toContain('🏀 Ana scored 2 points!');

  // Mess on the floor, then the broom: only the host mops, for everyone.
  for (const [x, z] of [
    [4.4, 2.8],
    [4.0, 4.4],
  ] as const) {
    await budi.waitForTimeout(700);
    await budi.evaluate(([px, pz]) => (window.__huddle as Hooks).throw('paper', px, 0, pz), [x, z]);
  }
  await expect.poll(() => projectilesOf(ana)).toBeGreaterThan(0);
  await budi.evaluate(() => (window.__huddle as Hooks).clean());
  await expect.poll(() => toastKeys(budi)).toContain('toast.cleanHostOnly');
  await ana.evaluate(() => (window.__huddle as Hooks).clean());
  for (const page of [ana, budi]) await expect.poll(() => projectilesOf(page)).toBe(0);
  await expect.poll(() => chatOf(budi)).toContain('🧹 Ana cleaned up the room');
  await expect.poll(async () => (await look(budi, anaId))?.action ?? null).toBe('mop');

  await ana.context().close();
  await budi.context().close();
});
