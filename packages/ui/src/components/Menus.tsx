import { actionAllowed } from '@huddle/shared';
import type { ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import { WHEEL_ITEMS } from '../store-play.ts';
import { EMOTES, HeldGlyph, Icon, REACTIONS, THROW_ICONS } from './icons.tsx';
import { Kbd, Switch } from './ui.tsx';

/**
 * Play: pick something to throw (one throw per pick: pick, then click in the room), hold up a
 * phone or a sign, "Don't hit me", and the clean-up.
 */
export function PlayMenu(): ReactNode {
  const t = useT();
  const c = useCommands();
  const aim = useHud((s) => s.aim);
  const held = useHud((s) => s.play.held);
  const shield = useHud((s) => s.play.shield);
  const locked = useHud(
    (s) => s.room !== null && (s.room.mode === 'serious' || s.room.throwsLocked),
  );
  const canClean = useHud((s) => s.room === null || s.room.isHost);
  const off = shield || locked;
  return (
    <div
      className="popover popover--bar surface enter-pop"
      id="pop-play"
      role="dialog"
      aria-label={t('bar.play')}
    >
      <section className="menu-section">
        <h3 className="menu-label">
          {t('play.throw')}
          <span className="menu-label__hint">{t('play.throwHint')}</span>
        </h3>
        {off && (
          <p className="menu-note">{t(shield ? 'toast.shieldNoThrow' : 'toast.throwsOff')}</p>
        )}
        <div className="tiles tiles--6" role="group" aria-label={t('throw.title')}>
          {THROW_ICONS.map((it, i) => {
            const active = aim === it.kind;
            return (
              <button
                key={it.kind}
                type="button"
                className={`tile ${active ? 'is-active' : ''}`}
                disabled={off}
                aria-pressed={active}
                aria-label={t(`throw.label.${it.kind}`)}
                aria-keyshortcuts={String(i + 1)}
                onClick={() => {
                  c.setAim(active ? null : it.kind);
                  c.setPopover(null);
                }}
              >
                <span className="tile__emoji" aria-hidden="true">
                  {it.emoji}
                </span>
                <span className="tile__label" aria-hidden="true">
                  {t(`throw.label.${it.kind}`)}
                </span>
                <kbd className="tile__key" aria-hidden="true">
                  {i + 1}
                </kbd>
              </button>
            );
          })}
        </div>
      </section>
      <section className="menu-section">
        <h3 className="menu-label">{t('hold.title')}</h3>
        <div className="tiles tiles--5" role="group" aria-label={t('hold.title')}>
          {WHEEL_ITEMS.map((item) => {
            const active = held === item;
            return (
              <button
                key={item}
                type="button"
                className={`tile tile--glyph ${active ? 'is-active' : ''}`}
                aria-pressed={active}
                aria-label={t(`hold.${item}`)}
                title={t(`hold.${item}`)}
                onClick={() => {
                  c.holdItem(active ? null : item);
                  c.setPopover(null);
                }}
              >
                <HeldGlyph item={item} />
              </button>
            );
          })}
        </div>
      </section>
      <div className="menu-sep" />
      <Switch
        label={t('settings.dontHitMe')}
        hint={t('settings.dontHitMeHint')}
        checked={shield}
        onChange={(on) => c.setShield(on)}
      />
      <button
        type="button"
        className="menu-item"
        disabled={!canClean}
        onClick={() => {
          c.clearMess();
          c.setPopover(null);
        }}
      >
        <Icon name="broom" size={18} />
        <span className="menu-item__label">
          {t(canClean ? 'dock.cleanup' : 'dock.cleanupHost')}
        </span>
      </button>
    </div>
  );
}

/** React: quick emoji reactions (stays open for a few in a row) and emotes. */
export function ReactMenu(): ReactNode {
  const t = useT();
  const c = useCommands();
  const mode = useHud((s) => s.room?.mode ?? 'casual');
  return (
    <div
      className="popover popover--bar surface enter-pop"
      id="pop-react"
      role="dialog"
      aria-label={t('bar.react')}
    >
      <div className="reactions" role="group" aria-label={t('reactions.title')}>
        {REACTIONS.map((r) => (
          <button
            key={r}
            type="button"
            className="reaction"
            onClick={() => c.react(r)}
            aria-label={r}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="menu-sep" />
      <section className="menu-section">
        <h3 className="menu-label">
          {t('react.emotes')}
          {mode === 'serious' && <span className="menu-label__hint">{t('emote.serious')}</span>}
        </h3>
        <div className="tiles tiles--4" role="group" aria-label={t('react.emotes')}>
          {EMOTES.map((em) => (
            <button
              key={em.id}
              type="button"
              className="tile tile--stack"
              disabled={!actionAllowed(mode, em.id)}
              onClick={() => {
                c.emote(em.id);
                c.setPopover(null);
              }}
            >
              <span className="tile__emoji" aria-hidden="true">
                {em.emoji}
              </span>
              <span className="tile__label">{t(`emote.${em.id}`)}</span>
            </button>
          ))}
        </div>
      </section>
      <p className="menu-foot">
        <Kbd>Q</Kbd>
        {t('react.wheelHint')}
      </p>
    </div>
  );
}
