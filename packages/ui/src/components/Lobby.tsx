import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import type { LobbyUi } from '../store.ts';
import { Brand } from './Brand.tsx';
import { GreenRoom } from './GreenRoom.tsx';
import { Icon } from './icons.tsx';
import { enterDelay as delay, Segmented } from './ui.tsx';

export interface LocaleOption {
  id: string;
  label: string;
}

/** Short language names for the switch (the full names live in Settings). */
const SHORT: Readonly<Record<string, string>> = { en: 'EN', id: 'ID' };

function LobbyTop({ locales }: { locales: readonly LocaleOption[] }): ReactNode {
  const t = useT();
  const c = useCommands();
  const locale = useHud((s) => s.locale);
  return (
    <header className="lobby__top enter-fade" style={delay(0)}>
      <Brand size={34} />
      {locales.length > 1 && (
        <span className="lobby__lang">
          <Icon name="globe" size={16} />
          <Segmented
            label={t('settings.language')}
            value={locale}
            options={locales.map((l) => ({
              id: l.id,
              label: SHORT[l.id] ?? l.id.toUpperCase(),
              title: l.label,
            }))}
            onChange={(id) => c.setLocale(id)}
            small
          />
        </span>
      )}
    </header>
  );
}

/**
 * The landing: one line that says what this is, then the two ways in (a new room, or the code
 * someone sent you) and solo practice with the AI office-mates.
 */
function Landing({ lobby }: { lobby: LobbyUi }): ReactNode {
  const t = useT();
  const c = useCommands();
  const roomName = useHud((s) => s.roomName);
  const [code, setCode] = useState(lobby.room);
  const codeId = useId();
  // Back from a room (or the green room): its code is ready to rejoin.
  useEffect(() => setCode(lobby.room), [lobby.room]);
  const join = (e: FormEvent): void => {
    e.preventDefault();
    if (code.trim()) c.setLobbyStep('ready', code);
  };
  const typing = { onFocus: () => c.setTyping(true), onBlur: () => c.setTyping(false) };
  return (
    <>
      <main className="landing">
        <h1 id="lobby-title" className="landing__title enter-up" style={delay(80)}>
          {t('lobby.headline')}
        </h1>
        <p className="landing__sub enter-up" style={delay(170)}>
          {t('lobby.sub')}
        </p>
        <div className="landing__actions enter-up" style={delay(260)}>
          <button
            type="button"
            className="btn btn--primary btn--xl"
            onClick={() => c.setLobbyStep('ready', '')}
          >
            <Icon name="plus" size={20} />
            {t('lobby.newRoom')}
          </button>
          <form className={`code-field ${code.trim() ? 'has-code' : ''}`} onSubmit={join}>
            <label className="sr-only" htmlFor={codeId}>
              {t('lobby.room')}
            </label>
            <input
              id={codeId}
              className="code-field__input"
              value={code}
              maxLength={12}
              spellCheck={false}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder={t('lobby.codePlaceholder')}
              aria-invalid={lobby.error === 'lobby.error.code'}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              {...typing}
            />
            <button type="submit" className="code-field__go" disabled={!code.trim()}>
              {t('lobby.go')}
              <Icon name="arrowRight" size={18} />
            </button>
          </form>
        </div>
        {lobby.error && (
          <p className="landing__error" role="alert">
            {t(lobby.error)}
          </p>
        )}
        <button
          type="button"
          className="landing__solo enter-up"
          style={delay(340)}
          onClick={() => c.playOffline()}
        >
          <Icon name="sparkle" size={16} />
          {t('lobby.offline')}
          <Icon name="arrowRight" size={16} />
        </button>
      </main>
      <aside className="landing__scene enter-fade" style={delay(500)} aria-hidden="true">
        <span className="landing__live" />
        <span>
          <b>{t(roomName)}</b>
          <small>{t('lobby.roomFacts')}</small>
        </span>
      </aside>
    </>
  );
}

/**
 * Before the room, over the live 3D room: the landing, then the green room (you in the room:
 * name, look, microphone). Stays mounted (hidden) under the avatar editor, so nothing typed is
 * lost.
 */
export function Lobby({ locales }: { locales: readonly LocaleOption[] }): ReactNode {
  const lobby = useHud((s) => s.lobby);
  const avatarOpen = useHud((s) => s.avatarOpen);
  if (!lobby) return null;
  const ready = lobby.step === 'ready';
  return (
    <div
      className={`lobby lobby--${lobby.step}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ready ? 'green-title' : 'lobby-title'}
      hidden={avatarOpen}
    >
      <div className="lobby__scrim" aria-hidden="true" />
      <LobbyTop locales={locales} />
      {ready ? <GreenRoom lobby={lobby} /> : <Landing lobby={lobby} />}
    </div>
  );
}
