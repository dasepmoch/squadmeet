import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Hud } from './components/Hud.tsx';
import { HudProvider } from './context.tsx';
import type { HudCommands, HudStore, Translate } from './store.ts';

export interface MountOptions {
  element: HTMLElement;
  store: HudStore;
  commands: HudCommands;
  translatorFor: (locale: string) => Translate;
  locales: readonly { id: string; label: string }[];
}

/** Mounts the React HUD overlay. Returns an unmount function. */
export function mountHud(options: MountOptions): () => void {
  const root: Root = createRoot(options.element);
  root.render(
    <StrictMode>
      <HudProvider
        store={options.store}
        commands={options.commands}
        translatorFor={options.translatorFor}
      >
        <Hud store={options.store} locales={options.locales} />
      </HudProvider>
    </StrictMode>,
  );
  return () => root.unmount();
}
