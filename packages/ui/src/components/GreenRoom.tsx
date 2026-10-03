import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import type { LobbyUi } from '../store.ts';
import { Icon } from './icons.tsx';
import { MicSetup } from './MicSetup.tsx';
import { enterDelay as delay } from './ui.tsx';

/**
 * Tells the camera how much of the screen the panel covers, so your avatar is framed in the
 * rest: beside a side panel on wide screens, above a bottom sheet on phones. Measured after
 * every layout (and window resize): the panel grows and shrinks with its content.
 */
function useStageInsets(panel: { current: HTMLElement | null }): void {
  const c = useCommands();
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const send = (): void => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // A sheet that spans (nearly) the whole width sits at the bottom.
      if (el.offsetWidth > w * 0.7) c.setLobbyInsets(0, (h - el.offsetTop) / h);
      else c.setLobbyInsets((el.offsetLeft + el.offsetWidth) / w, 0);
    };
    send();
    window.addEventListener('resize', send);
    return () => window.removeEventListener('resize', send);
  });
}

/**
 * The green room: your avatar stands in the room next to this panel, wearing the name you type.
 * Shuffle or customize the look, check the microphone (the meter, your mouth and your tag move
 * as you talk; "hear yourself" plays a few seconds back), then walk in.
 */
export function GreenRoom({ lobby }: { lobby: LobbyUi }): ReactNode {
  const t = useT();
  const c = useCommands();
  const muted = useHud((s) => s.voice.muted || s.voice.mic !== 'live');
  const panel = useRef<HTMLFormElement | null>(null);
  const [passcode, setPasscode] = useState('');
  const [wantsPasscode, setWantsPasscode] = useState(false);
  const nameId = useId();
  const passId = useId();
  useStageInsets(panel);
  const creating = lobby.room === '';
  const askPasscode = lobby.needsPasscode || (creating && wantsPasscode);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    c.joinRoom(lobby.room, lobby.name, askPasscode ? passcode : '');
  };
  const shuffle = (): void => c.saveAvatar(c.randomAvatar(), lobby.name);
  const typing = { onFocus: () => c.setTyping(true), onBlur: () => c.setTyping(false) };
  return (
    <form
      ref={panel}
      className="green surface"
      onSubmit={submit}
      aria-labelledby="green-title"
      aria-busy={lobby.busy}
    >
      <div className="green__head enter-up" style={delay(120)}>
        <button
          type="button"
          className="green__back"
          onClick={() => c.setLobbyStep('start')}
          disabled={lobby.busy}
        >
          <Icon name="arrowLeft" size={16} />
          {t('lobby.back')}
        </button>
        <span className="green__room">
          {creating ? (
            t('lobby.ready.newRoom')
          ) : (
            <>
              {t('lobby.ready.room')} <b>{lobby.room}</b>
            </>
          )}
        </span>
      </div>
      <h2 id="green-title" className="green__title enter-up" style={delay(170)}>
        {t('lobby.ready.title')}
      </h2>
      <p className="green__sub enter-up" style={delay(220)}>
        {t('lobby.ready.sub')}
      </p>
      <div className="green__body enter-up" style={delay(280)}>
        <div className="field">
          <label className="field__label" htmlFor={nameId}>
            {t('lobby.name')}
          </label>
          <input
            id={nameId}
            className="input input--lg"
            value={lobby.name}
            maxLength={24}
            autoComplete="nickname"
            onChange={(e) => c.previewName(e.target.value)}
            {...typing}
          />
        </div>
        <div className="green__look">
          <button type="button" className="btn btn--sm" onClick={shuffle}>
            <Icon name="shuffle" size={16} />
            {t('lobby.shuffle')}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => c.setAvatarOpen(true)}>
            <Icon name="shirt" size={16} />
            {t('lobby.customize')}
          </button>
        </div>
        <MicSetup />
        {askPasscode && (
          <div className="field enter-up">
            <label className="field__label" htmlFor={passId}>
              {t(lobby.needsPasscode ? 'lobby.passcode' : 'lobby.passcodeOptional')}
            </label>
            <input
              id={passId}
              className="input"
              type="password"
              value={passcode}
              maxLength={64}
              autoComplete="off"
              onChange={(e) => setPasscode(e.target.value)}
              {...typing}
            />
          </div>
        )}
        {!askPasscode && creating && (
          <button type="button" className="link-btn" onClick={() => setWantsPasscode(true)}>
            <Icon name="lock" size={14} />
            {t('lobby.addPasscode')}
          </button>
        )}
      </div>
      <div className="green__foot enter-up" style={delay(340)}>
        {lobby.error && (
          <p className="green__error" role="alert">
            {t(lobby.error)}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={lobby.busy}>
          {lobby.busy && <span className="spinner" aria-hidden="true" />}
          {t(lobby.busy ? 'lobby.joining' : creating ? 'lobby.create' : 'lobby.join')}
          {!lobby.busy && <Icon name="arrowRight" size={18} />}
        </button>
        <p className="green__hint">
          <Icon name={muted ? 'micOff' : 'mic'} size={14} />
          {t(muted ? 'lobby.ready.muted' : 'lobby.ready.live')}
        </p>
      </div>
    </form>
  );
}
