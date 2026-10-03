import { useState, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import type { PersonUi, RoomUi } from '../store.ts';
import { LogoMark } from './Brand.tsx';
import { Icon } from './icons.tsx';
import { IconButton, Segmented, Switch } from './ui.tsx';
import { HostVoiceControls } from './Voice.tsx';

const MODES: readonly RoomUi['mode'][] = ['serious', 'casual', 'party'];

/** Top-left: the mark, the room's name and connection, the invite code and the room mode. */
export function RoomIsland(): ReactNode {
  const t = useT();
  const roomName = useHud((s) => s.roomName);
  const net = useHud((s) => s.net);
  const room = useHud((s) => s.room);
  return (
    <header className="island island--room surface">
      <LogoMark size={22} />
      <span className="island__sep" aria-hidden="true" />
      <span className="room-name">
        <span className="status-dot" data-net={net} aria-hidden="true" />
        <span className="room-name__text">{roomName ? t(roomName) : ''}</span>
      </span>
      {room ? (
        <RoomCode code={room.code} locked={room.locked} />
      ) : (
        <span className="badge">{t('net.solo')}</span>
      )}
      <ModeBadge />
    </header>
  );
}

/** The invite code: click to copy a link to this room. */
function RoomCode({ code, locked }: { code: string; locked: boolean }): ReactNode {
  const t = useT();
  const c = useCommands();
  return (
    <span className="tip-host tip-host--bottom">
      <button
        type="button"
        className="code-chip"
        onClick={() => c.copyInvite()}
        aria-label={t('room.copyInvite', { code })}
      >
        {locked && <Icon name="lock" size={13} />}
        <span className="code-chip__code">{code}</span>
        <Icon name="copy" size={14} />
      </button>
      <span className="tip" aria-hidden="true">
        {t('room.copyTip')}
      </span>
    </span>
  );
}

/** The room mode (online); the host changes it from the people panel. */
function ModeBadge(): ReactNode {
  const t = useT();
  const c = useCommands();
  const mode = useHud((s) => s.room?.mode ?? null);
  const isHost = useHud((s) => s.room?.isHost ?? false);
  if (!mode) return null;
  const tip = t(`host.mode.${mode}Tip`);
  const label = `${t('host.mode')}: ${t(`host.mode.${mode}`)}. ${tip}`;
  return (
    <span className="tip-host tip-host--bottom">
      {isHost ? (
        <button
          type="button"
          className={`mode-badge mode-badge--${mode}`}
          onClick={() => c.setPanel('people')}
          aria-label={label}
        >
          {t(`host.mode.${mode}`)}
          <Icon name="chevronDown" size={14} />
        </button>
      ) : (
        <span className={`mode-badge mode-badge--${mode}`} role="note" aria-label={label}>
          {t(`host.mode.${mode}`)}
        </span>
      )}
      <span className="tip tip--wrap" aria-hidden="true">
        {tip}
      </span>
    </span>
  );
}

/** Reconnecting / connection lost, shown over the room. */
export function ConnectionBanner(): ReactNode {
  const t = useT();
  const c = useCommands();
  const net = useHud((s) => s.net);
  const lobby = useHud((s) => s.lobby);
  if (lobby) return null;
  if (net === 'reconnecting') {
    return (
      <div className="banner surface enter-down" role="status">
        <span className="spinner" aria-hidden="true" />
        {t('net.reconnecting')}
      </div>
    );
  }
  if (net !== 'failed') return null;
  return (
    <div className="banner banner--error surface enter-down" role="alert">
      <span className="banner__dot" aria-hidden="true" />
      {t('net.lost')}
      <button type="button" className="btn btn--sm" onClick={() => c.leaveRoom()}>
        {t('net.backToLobby')}
      </button>
    </div>
  );
}

/** Host settings at the top of the people panel. */
export function HostSettings(): ReactNode {
  const t = useT();
  const c = useCommands();
  const room = useHud((s) => s.room);
  const [open, setOpen] = useState(true);
  if (!room?.isHost) return null;
  return (
    <section className="host" aria-label={t('host.title')}>
      <button
        type="button"
        className="host__toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="crown" size={16} />
        <span>{t('host.title')}</span>
        <span className={`host__chevron ${open ? 'is-open' : ''}`}>
          <Icon name="chevronDown" size={16} />
        </span>
      </button>
      {open && (
        <div className="host__body">
          <div className="host__group">
            <span className="host__label">{t('host.mode')}</span>
            <Segmented
              label={t('host.mode')}
              value={room.mode}
              options={MODES.map((m) => ({ id: m, label: t(`host.mode.${m}`) }))}
              onChange={(m) => c.setRoomMode(m)}
              small
            />
            <p className="host__tip">{t(`host.mode.${room.mode}Tip`)}</p>
          </div>
          <Switch
            label={t('host.lockThrows')}
            checked={room.throwsLocked}
            onChange={(on) => c.lockThrows(on)}
          />
          <HostVoiceControls />
          <div className="host__actions">
            <button type="button" className="btn btn--sm" onClick={() => c.clearMess()}>
              <Icon name="broom" size={16} />
              {t('host.cleanAll')}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => c.resetScores()}>
              {t('host.resetScores')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Per-person host buttons (lower hand, make host, remove). */
export function PersonHostActions({ person }: { person: PersonUi }): ReactNode {
  const t = useT();
  const c = useCommands();
  const isHost = useHud((s) => s.room?.isHost ?? false);
  if (!isHost || person.isLocal || person.isBot) return null;
  const kick = (): void => {
    if (window.confirm(t('host.kickConfirm', { name: person.name }))) c.kick(person.id);
  };
  return (
    <>
      {person.handRaised && (
        <IconButton
          icon="hand"
          size="sm"
          tip={false}
          label={t('host.lowerHand', { name: person.name })}
          onClick={() => c.lowerHand(person.id)}
        />
      )}
      <IconButton
        icon="crown"
        size="sm"
        tip={false}
        label={t('host.makeHost', { name: person.name })}
        onClick={() => c.makeHost(person.id)}
      />
      <IconButton
        icon="close"
        size="sm"
        tip={false}
        tone="danger"
        label={t('host.kick', { name: person.name })}
        onClick={kick}
      />
    </>
  );
}
