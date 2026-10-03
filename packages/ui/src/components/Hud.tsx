import { useEffect, useState, type ReactNode } from 'react';
import { useHud } from '../context.tsx';
import type { HudStore } from '../store.ts';
import { AvatarEditor } from './AvatarEditor.tsx';
import { ControlBar } from './ControlBar.tsx';
import { DebugOverlay } from './DebugOverlay.tsx';
import { EmoteWheel } from './EmoteWheel.tsx';
import { ErrorScreen, LoadingScreen } from './Intro.tsx';
import { Lobby } from './Lobby.tsx';
import { AimHint, BoardToolbar, HelpPanel } from './Modes.tsx';
import {
  CoachTips,
  ContextLostBanner,
  HeldChip,
  InteractionPrompt,
  ScreenTooltip,
  Toasts,
} from './Overlays.tsx';
import { ConnectionBanner, RoomIsland } from './Room.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { ShareBar } from './Share.tsx';
import { ChatPanel, HandQueue, PeoplePanel } from './SidePanels.tsx';
import { Theater } from './Theater.tsx';
import { TopRight } from './TopBar.tsx';
import { useExit } from './ui.tsx';

export interface HudProps {
  store: HudStore;
  locales: readonly { id: string; label: string }[];
}

/** How long the intro takes to open onto the lobby (lobby.css `.intro.is-leaving`). */
const INTRO_EXIT_MS = 1000;
/** The intro plays at least this long, so a fast (cached) load still shows it whole. */
const INTRO_MIN_MS = 2400;

/** The intro screen: up while loading and for its minimum run, then a fade into the lobby. */
function useIntro(
  loading: boolean,
  reducedMotion: boolean,
): { mounted: boolean; leaving: boolean } {
  const [hold, setHold] = useState(true);
  useEffect(() => {
    const handle = window.setTimeout(() => setHold(false), INTRO_MIN_MS);
    return () => window.clearTimeout(handle);
  }, []);
  return useExit(loading || (hold && !reducedMotion), INTRO_EXIT_MS);
}

/** Everything over the room while you are in it (not in the lobby, not in Theater Mode). */
function RoomHud({ boardMode }: { boardMode: boolean }): ReactNode {
  return (
    <>
      <div className="corner corner--tl">
        <RoomIsland />
      </div>
      <div className="corner corner--tr">
        <TopRight />
        <HandQueue />
      </div>
      <ScreenTooltip />
      <div className="stack-bottom">
        <InteractionPrompt />
        <HeldChip />
        {boardMode ? <BoardToolbar /> : <ControlBar />}
      </div>
      {!boardMode && <CoachTips />}
      <ChatPanel />
      <PeoplePanel />
      <HelpPanel />
      <EmoteWheel />
    </>
  );
}

/** Root of the DOM overlay. Pure view: reads the store, calls commands. */
export function Hud({ store, locales }: HudProps): ReactNode {
  const phase = useHud((s) => s.phase);
  const reducedMotion = useHud((s) => s.reducedMotion);
  const boardMode = useHud((s) => s.board !== null);
  const inLobby = useHud((s) => s.lobby !== null);
  const theater = useHud((s) => s.theater !== null);
  const intro = useIntro(phase === 'loading', reducedMotion);
  const ready = phase === 'ready';
  const inRoom = ready && !inLobby;
  return (
    <div
      className="hud"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-theater={theater ? 'true' : 'false'}
    >
      {(phase === 'error' || phase === 'unsupported') && <ErrorScreen />}
      {ready && inLobby && <Lobby locales={locales} />}
      {inRoom && !theater && <RoomHud boardMode={boardMode} />}
      {inRoom && theater && <Theater />}
      {ready && (
        <>
          <DebugOverlay />
          <AvatarEditor />
          <SettingsPanel locales={locales} />
        </>
      )}
      <div className="stack-top">
        {inRoom && (
          <>
            <ConnectionBanner />
            <ContextLostBanner />
            {!theater && <ShareBar />}
            {!theater && <AimHint />}
          </>
        )}
        <Toasts store={store} />
      </div>
      {intro.mounted && <LoadingScreen leaving={intro.leaving} />}
    </div>
  );
}
