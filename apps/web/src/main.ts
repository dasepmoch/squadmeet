import '@fontsource-variable/inter';
// Display face for headlines (the wordmark itself is drawn from its outlines).
import '@fontsource/unbounded/latin-600.css';
import '@fontsource/unbounded/latin-700.css';
import './styles.css';
import { DEFAULT_ROOM_ID, loadRoom } from '@huddle/content';
import { PhysicsWorld, type WalkGrid } from '@huddle/engine';
import { missingRequirements } from '@huddle/platform';
import { createWebPlatform } from '@huddle/platform-web';
import type { TextureBundle, TextureBundleOptions } from '@huddle/render';
import type { ResolvedRoom } from '@huddle/shared';
import { installDebugHooks } from './app/debug-hooks.ts';
import { GameApp } from './app/game-app.ts';
import { createNavWorker, createTextureWorker, runWorker } from './workers/run-worker.ts';

function element<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`App shell is missing #${id}`);
  return el;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function boot(): Promise<void> {
  const appRoot = element('app', HTMLDivElement);
  const canvas = element('scene', HTMLCanvasElement);
  const uiRoot = element('ui-root', HTMLDivElement);
  const platform = createWebPlatform({
    viewportTarget: appRoot,
    logLevel: import.meta.env.DEV ? 'debug' : 'info',
  });
  const app = new GameApp({ platform, canvas, uiRoot });
  document.documentElement.lang = app.store.getState().locale;
  if (missingRequirements(platform.capabilities).length > 0) {
    app.store.setState({ phase: 'unsupported' });
    return;
  }
  try {
    app.setLoading('app.loadingTextures', 0.08);
    const options: TextureBundleOptions = {
      floorSize: platform.capabilities.mobile ? 512 : 1024,
      detailSize: platform.capabilities.mobile ? 128 : 256,
    };
    let done = 0;
    const step = <T>(p: Promise<T>, key: string): Promise<T> =>
      p.then((v) => {
        done++;
        app.setLoading(key, 0.2 + done * 0.22);
        return v;
      });
    const [textures, physics, room] = await Promise.all([
      step(
        runWorker<TextureBundleOptions, TextureBundle>(createTextureWorker, options),
        'app.loadingPhysics',
      ),
      step(PhysicsWorld.create(), 'app.loadingRoom'),
      step(loadRoom(DEFAULT_ROOM_ID), 'app.loadingRoom'),
    ]);
    app.setLoading('app.loadingRoom', 0.9);
    await nextFrame();
    await app.start(room.resolved, physics, textures);
    installDebugHooks(app);
    runWorker<ResolvedRoom, WalkGrid>(createNavWorker, room.resolved)
      .then((grid) => app.installWalkGrid(grid))
      .catch((err: unknown) => {
        platform.logger.warn('walk grid bake failed; click-to-move disabled', err);
        app.installWalkGrid(null);
      });
  } catch (err: unknown) {
    app.fail(err);
  }
}

void boot();
