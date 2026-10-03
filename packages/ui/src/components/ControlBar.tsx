import { useRef, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import { THROW_ICONS } from './icons.tsx';
import { PlayMenu, ReactMenu } from './Menus.tsx';
import { IconButton, useDismiss } from './ui.tsx';

/** Mute (asks for the microphone the first time) with the "you're muted" nudge above it. */
function MicButton({ before }: { before: () => void }): ReactNode {
  const t = useT();
  const c = useCommands();
  const online = useHud((s) => s.room !== null);
  const v = useHud((s) => s.voice);
  const live = v.mic === 'live';
  const open = live && (!v.muted || v.talking);
  const blocked = v.mic === 'denied' || v.mic === 'unavailable' || v.mic === 'failed';
  let label = t(open ? 'dock.mute' : 'dock.unmute');
  if (!online) label = t('voice.offline');
  else if (v.overCap) label = t('voice.overCapShort');
  else if (blocked) label = t(`voice.mic.${v.mic}`);
  return (
    <span className="mic-wrap">
      {v.mutedSpeaking && (
        <span className="mic-hint surface enter-up" role="status">
          {t('voice.mutedHint')}
        </span>
      )}
      <IconButton
        icon={open ? 'mic' : 'micOff'}
        label={label}
        kbd={online ? 'M' : undefined}
        disabled={!online || v.overCap}
        tone={online && !open && !v.overCap ? 'off' : null}
        className={open && v.speaking ? 'is-speaking' : ''}
        onClick={() => {
          before();
          c.toggleMute();
        }}
      />
    </span>
  );
}

/**
 * The one control bar: voice, presence (hand, react, play), room tools (share, board, chat) and
 * leaving. React and Play open small menus above it; any other button closes them.
 */
export function ControlBar(): ReactNode {
  const t = useT();
  const c = useCommands();
  const popover = useHud((s) => s.popover);
  const handRaised = useHud((s) => s.handRaised);
  const sharing = useHud((s) => s.sharing);
  const shareSupported = useHud((s) => s.shareSupported);
  const board = useHud((s) => s.board !== null);
  const panel = useHud((s) => s.panel);
  const unread = useHud((s) => s.unread);
  const online = useHud((s) => s.room !== null);
  const deafened = useHud((s) => s.voice.deafened);
  const overCap = useHud((s) => s.voice.overCap);
  const aim = useHud((s) => s.aim);
  const bar = useRef<HTMLElement | null>(null);
  const menuOpen = popover === 'play' || popover === 'react';
  useDismiss(menuOpen, bar, () => c.setPopover(null));
  const closeMenus = (): void => {
    if (menuOpen) c.setPopover(null);
  };
  const run = (fn: () => void) => (): void => {
    closeMenus();
    fn();
  };
  const toggle = (p: 'play' | 'react') => (): void => c.setPopover(popover === p ? null : p);
  const aimEmoji = aim ? THROW_ICONS.find((i) => i.kind === aim)?.emoji : undefined;
  return (
    <nav className="cbar" aria-label={t('dock.label')} ref={bar}>
      {popover === 'play' && <PlayMenu />}
      {popover === 'react' && <ReactMenu />}
      <div className="cbar__inner surface">
        <MicButton before={closeMenus} />
        <IconButton
          icon={deafened ? 'headphonesOff' : 'headphones'}
          label={t(deafened ? 'dock.undeafen' : 'dock.deafen')}
          kbd={online ? 'N' : undefined}
          disabled={!online || overCap}
          tone={deafened ? 'off' : null}
          onClick={run(() => c.toggleDeafen())}
        />
        <span className="cbar__sep" aria-hidden="true" />
        <IconButton
          icon="hand"
          label={t(handRaised ? 'dock.lowerHand' : 'dock.raiseHand')}
          kbd="H"
          pressed={handRaised}
          tone={handRaised ? 'warn' : null}
          onClick={run(() => c.raiseHand())}
        />
        <IconButton
          icon="smile"
          label={t('bar.react')}
          expanded={popover === 'react'}
          controls="pop-react"
          tone={popover === 'react' ? 'on' : null}
          onClick={toggle('react')}
        />
        <IconButton
          icon="play"
          label={t('bar.play')}
          kbd="G"
          expanded={popover === 'play'}
          controls="pop-play"
          tone={popover === 'play' || aim ? 'on' : null}
          onClick={toggle('play')}
        >
          {aimEmoji && (
            <span className="ibtn__emoji" aria-hidden="true">
              {aimEmoji}
            </span>
          )}
        </IconButton>
        <span className="cbar__sep" aria-hidden="true" />
        <IconButton
          icon="screen"
          label={t(sharing ? 'dock.stopShare' : 'dock.share')}
          pressed={sharing}
          tone={sharing ? 'on' : null}
          disabled={!shareSupported}
          onClick={run(() => c.toggleShare())}
        />
        <IconButton
          icon="board"
          label={t('dock.board')}
          pressed={board}
          tone={board ? 'on' : null}
          onClick={run(() => (board ? c.closeBoard() : c.openBoard()))}
        />
        <IconButton
          icon="chat"
          label={t('dock.chat')}
          kbd="Enter"
          pressed={panel === 'chat'}
          tone={panel === 'chat' ? 'on' : null}
          badge={panel === 'chat' ? 0 : unread}
          onClick={run(() => c.setPanel(panel === 'chat' ? null : 'chat'))}
        />
        {online && (
          <>
            <span className="cbar__sep" aria-hidden="true" />
            <IconButton
              icon="leave"
              label={t('room.leave')}
              tone="danger"
              onClick={run(() => c.leaveRoom())}
            />
          </>
        )}
      </div>
    </nav>
  );
}
