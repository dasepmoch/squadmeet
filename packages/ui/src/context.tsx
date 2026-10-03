import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { HudCommands, HudState, HudStore, Translate } from './store.ts';

interface HudContextValue {
  store: HudStore;
  commands: HudCommands;
  translatorFor: (locale: string) => Translate;
}

const HudContext = createContext<HudContextValue | null>(null);

export function HudProvider(props: HudContextValue & { children: ReactNode }): ReactNode {
  const { children, ...value } = props;
  return <HudContext.Provider value={value}>{children}</HudContext.Provider>;
}

function useHudContext(): HudContextValue {
  const ctx = useContext(HudContext);
  if (!ctx) throw new Error('HUD context missing');
  return ctx;
}

export function useHud<T>(selector: (s: HudState) => T): T {
  return useStore(useHudContext().store, selector);
}

export function useCommands(): HudCommands {
  return useHudContext().commands;
}

/** Translator for the current locale; re-renders when the locale changes. */
export function useT(): Translate {
  const ctx = useHudContext();
  const locale = useStore(ctx.store, (s) => s.locale);
  return ctx.translatorFor(locale);
}
