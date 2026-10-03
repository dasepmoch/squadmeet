import { expect, test, type Browser, type Page } from '@playwright/test';

/** The `?debug=1` hooks used here (see apps/web/src/app/debug-hooks.ts). */
interface Hooks {
  ready: boolean;
  quality(level: 'low'): void;
  join(room: string, name: string): void;
  net(): { state: string; self: string | null };
  voice(): Promise<{
    mic: string;
    muted: boolean;
    peers: { id: string; state: string }[];
    sources: { id: string; level: number; speaking: boolean }[];
  } | null>;
  share(): { presenter: string | null; sharing: boolean; wall: string; video: number[] } | null;
  shareTest(withAudio?: boolean): void;
}

interface AppHandle {
  store: {
    getState(): {
      people: { name: string; muted: boolean; speaking: boolean }[];
      toasts: { textKey: string }[];
      sharing: boolean;
    };
  };
}

declare global {
  interface Window {
    __huddle?: Hooks;
    __huddleApp?: unknown;
  }
}

const SOFTWARE = process.env.E2E_GPU === 'swiftshader' || process.platform !== 'darwin';

async function openClient(browser: Browser): Promise<Page> {
  // Separate contexts are separate people; the fake microphone is allowed up front.
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  await page.goto(`/?debug=1&screen=idle${process.env.CI || SOFTWARE ? '&render=0' : ''}`);
  await page.waitForFunction(() => window.__huddle?.ready === true, null, { timeout: 120_000 });
  await page.evaluate(() => {
    (window.__huddle as Hooks).quality('low');
    const app = window.__huddleApp as {
      store: {
        subscribe(fn: (s: { toasts: { textKey: string }[] }) => void): void;
      };
    };
    const seen: string[] = ((window as unknown as { __toasts?: string[] }).__toasts = []);
    app.store.subscribe((s) => {
      for (const t of s.toasts) {
        if (!seen.includes(t.textKey)) seen.push(t.textKey);
      }
    });
  });
  return page;
}

const net = (page: Page) => page.evaluate(() => (window.__huddle as Hooks).net());
const voice = (page: Page) => page.evaluate(() => (window.__huddle as Hooks).voice());
const share = (page: Page) => page.evaluate(() => (window.__huddle as Hooks).share());
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window.__huddleApp as AppHandle).store.getState();
    const seen = (window as unknown as { __toasts?: string[] }).__toasts ?? [];
    const current = s.toasts.map((t) => t.textKey);
    const toasts = Array.from(new Set([...seen, ...current]));
    return { people: s.people, toasts, sharing: s.sharing };
  });
const personOf = async (page: Page, name: string) =>
  (await state(page)).people.find((p) => p.name === name);
/** Highest level heard from `source` over a second (voices come in syllables). */
async function loudest(page: Page, source: string | null): Promise<number> {
  let max = 0;
  for (let i = 0; i < 10; i++) {
    const s = (await voice(page))?.sources.find((x) => x.id === source);
    max = Math.max(max, s?.level ?? 0);
    await page.waitForTimeout(100);
  }
  return max;
}

/**
 * Clicks Share (the fake capture UI picks the screen). Where a headless machine has no screen to
 * capture, an animated canvas stream goes through the same presenter flow instead.
 */
async function startShare(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Share screen' }).click();
  try {
    await expect.poll(async () => (await state(page)).sharing, { timeout: 8000 }).toBe(true);
  } catch {
    test.info().annotations.push({ type: 'note', description: 'canvas stream instead of capture' });
    await page.evaluate(() => (window.__huddle as Hooks).shareTest(true));
  }
}

test('voice and screen sharing between two people', async ({ browser }) => {
  const room = `VS${Math.floor(1000 + Math.random() * 9000)}`;

  // Ana checks her microphone in the green room (the meter really moves), then joins (host).
  const ana = await openClient(browser);
  await ana.getByLabel('Room code').fill(room);
  await ana.getByRole('button', { name: 'Join', exact: true }).click();
  await ana.getByRole('button', { name: 'Test microphone' }).click();
  const meter = ana.getByRole('meter', { name: 'Microphone level' });
  await expect(meter).toBeVisible();
  await expect
    .poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // M in the green room flips whether you walk in with the mic on (and flips it back).
  await ana.keyboard.press('KeyM');
  await expect(ana.getByRole('switch', { name: /Mic on when you join/ })).toBeVisible();
  await ana.keyboard.press('KeyM');
  await expect(ana.getByRole('switch', { name: /You join muted/ })).toBeVisible();
  await ana.getByLabel('Your name').fill('Ana');
  await ana.getByRole('button', { name: 'Join room' }).click();
  await expect.poll(async () => (await net(ana)).state).toBe('joined');

  const budi = await openClient(browser);
  await budi.evaluate((r) => (window.__huddle as Hooks).join(r, 'Budi'), room);
  await expect.poll(async () => (await net(budi)).state).toBe('joined');
  const anaId = (await net(ana)).self;
  const budiId = (await net(budi)).self;

  // Everyone joins muted, with a live microphone (allowed) and a direct media link.
  await expect.poll(async () => (await voice(budi))?.peers[0]?.state).toBe('connected');
  await expect.poll(async () => (await personOf(budi, 'Ana'))?.muted).toBe(true);

  // Ana unmutes in the dock; Budi hears her and sees her speak.
  await ana.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect.poll(async () => (await personOf(budi, 'Ana'))?.muted).toBe(false);
  await expect.poll(() => loudest(budi, anaId)).toBeGreaterThan(0.1);
  await expect.poll(async () => (await personOf(budi, 'Ana'))?.speaking).toBe(true);
  const anaTag = budi.locator('.wl__tag', { hasText: 'Ana' });
  await expect(anaTag).toHaveClass(/wl__tag--speaking/);

  // M mutes again: silence for Budi, and the muted mark on her name tag.
  await ana.bringToFront();
  await ana.keyboard.press('KeyM');
  await expect.poll(async () => (await personOf(budi, 'Ana'))?.muted).toBe(true);
  await expect.poll(() => loudest(budi, anaId)).toBeLessThan(0.05);
  await expect(anaTag).toHaveClass(/wl__tag--muted/);

  // Ana presents: the "you are presenting" bar for her, her screen on Budi's wall.
  await startShare(ana);
  await expect(ana.getByText("You're presenting")).toBeVisible();
  await expect.poll(async () => (await share(budi))?.presenter).toBe(anaId);
  await expect.poll(async () => (await share(budi))?.wall).toBe('video');
  await expect.poll(async () => (await share(budi))?.video[0] ?? 0).toBeGreaterThan(0);

  // Theater Mode on Budi's side (T), with the presenter in the strip; Esc goes back.
  await budi.bringToFront();
  await budi.keyboard.press('KeyT');
  const theater = budi.getByRole('dialog', { name: 'Big screen' });
  await expect(theater).toBeVisible();
  await expect(theater.getByText('Ana is presenting')).toBeVisible();
  await budi.keyboard.press('Escape');
  await expect(theater).toBeHidden();

  // Budi asks for the screen; Ana hands over; the screen is free for Budi.
  await budi.getByRole('button', { name: 'Share screen' }).click();
  await expect.poll(async () => (await state(budi)).toasts).toContain('share.requested');
  await ana.getByRole('button', { name: 'Hand over' }).click();
  await expect.poll(async () => (await state(budi)).toasts).toContain('share.yourTurn');
  await expect.poll(async () => (await share(ana))?.sharing).toBe(false);

  // Budi presents; Ana, the host, takes the screen over.
  await budi.evaluate(() => (window.__huddle as Hooks).shareTest(true));
  await expect.poll(async () => (await share(ana))?.presenter).toBe(budiId);
  await expect.poll(async () => (await share(ana))?.wall).toBe('video');
  await expect.poll(() => loudest(ana, '#screen')).toBeGreaterThan(0.1);
  await ana.bringToFront();
  await startShare(ana);
  await expect.poll(async () => (await share(budi))?.presenter).toBe(anaId);
  await expect.poll(async () => (await state(budi)).toasts).toContain('share.takenOver');
  await expect.poll(async () => (await share(budi))?.sharing).toBe(false);

  // Stop: the wall goes back to the idle screen for everyone.
  await ana.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(async () => (await share(budi))?.presenter).toBeNull();
  await expect.poll(async () => (await share(budi))?.wall).toBe('idle');

  await ana.context().close();
  await budi.context().close();
});
