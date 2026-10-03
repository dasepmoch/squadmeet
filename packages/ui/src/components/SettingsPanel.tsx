import { ACTIONS, type ActionName } from '@huddle/shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import { keyName } from '../key-names.ts';
import type { LookUi, QualityChoiceUi } from '../store.ts';
import { IconButton, Segmented, Switch } from './ui.tsx';
import { AudioSettings } from './Voice.tsx';

const QUALITIES: readonly QualityChoiceUi[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const LOOKS: readonly LookUi[] = ['agx', 'aces', 'neutral'];
const TABS = ['general', 'graphics', 'audio', 'controls'] as const;
type Tab = (typeof TABS)[number];
const REMAPPABLE: ActionName[] = ACTIONS.filter((a): a is ActionName =>
  [
    'moveForward',
    'moveBack',
    'moveLeft',
    'moveRight',
    'sprint',
    'jump',
    'interact',
    'throw',
    'emoteWheel',
    'raiseHand',
    'pushToTalk',
    'mute',
    'deafen',
    'chat',
    'focusScreen',
    'theater',
    'cameraCycle',
    'cameraReset',
    'flyDown',
    'useItem',
    'debug',
  ].includes(a),
);

/** One rebindable action: its keys, and Change (press a key; Esc cancels). */
function RemapRow({ action }: { action: ActionName }): ReactNode {
  const t = useT();
  const commands = useCommands();
  const codes = useHud((s) => s.bindings[action]);
  const [capturing, setCapturing] = useState(false);
  const onChange = (): void => {
    setCapturing(true);
    commands
      .captureKey()
      .then((code) => {
        if (code !== 'Escape') commands.setBinding(action, [code]);
        setCapturing(false);
      })
      .catch(() => setCapturing(false));
  };
  return (
    <li className="remap__row">
      <span className="remap__label">{t(`action.${action}`)}</span>
      <span className="remap__keys">
        {capturing ? (
          <span className="remap__capture">{t('settings.pressKey')}</span>
        ) : (
          codes.map((c) => (
            <kbd key={c} className="kbd">
              {keyName(c, t)}
            </kbd>
          ))
        )}
      </span>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={onChange}
        disabled={capturing}
      >
        {t('settings.remap')}
      </button>
    </li>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="set-row">
      <span className="set-row__text">
        <span className="set-row__label">{label}</span>
        {hint && <span className="set-row__hint">{hint}</span>}
      </span>
      <span className="set-row__control">{children}</span>
    </div>
  );
}

function GeneralTab({ locales }: { locales: readonly { id: string; label: string }[] }): ReactNode {
  const t = useT();
  const c = useCommands();
  const locale = useHud((s) => s.locale);
  const reducedMotion = useHud((s) => s.reducedMotion);
  const shield = useHud((s) => s.play.shield);
  const langId = useId();
  return (
    <>
      <div className="set-row">
        <label className="set-row__label" htmlFor={langId}>
          {t('settings.language')}
        </label>
        <select
          id={langId}
          className="input select set-row__select"
          value={locale}
          onChange={(e) => c.setLocale(e.target.value)}
        >
          {locales.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <Switch
        label={t('settings.reducedMotion')}
        hint={t('settings.reducedMotionHint')}
        checked={reducedMotion}
        onChange={(on) => c.setReducedMotion(on)}
      />
      <Switch
        label={t('settings.dontHitMe')}
        hint={t('settings.dontHitMeHint')}
        checked={shield}
        onChange={(on) => c.setShield(on)}
      />
    </>
  );
}

function GraphicsTab(): ReactNode {
  const t = useT();
  const c = useCommands();
  const quality = useHud((s) => s.quality);
  const look = useHud((s) => s.look);
  return (
    <>
      <Row label={t('settings.quality')} hint={t('settings.qualityHint')}>
        <Segmented
          label={t('settings.quality')}
          value={quality}
          options={QUALITIES.map((q) => ({ id: q, label: t(`settings.quality.${q}`) }))}
          onChange={(q) => c.setQuality(q)}
          small
        />
      </Row>
      <Row label={t('settings.look')}>
        <Segmented
          label={t('settings.look')}
          value={look}
          options={LOOKS.map((l) => ({ id: l, label: t(`settings.look.${l}`) }))}
          onChange={(l) => c.setLook(l)}
          small
        />
      </Row>
    </>
  );
}

function ControlsTab(): ReactNode {
  const t = useT();
  const c = useCommands();
  return (
    <>
      <p className="settings__note">{t('settings.controlsHint')}</p>
      <ul className="remap">
        {REMAPPABLE.map((a) => (
          <RemapRow key={a} action={a} />
        ))}
      </ul>
      <button type="button" className="btn btn--sm" onClick={() => c.resetBindings()}>
        {t('settings.resetControls')}
      </button>
    </>
  );
}

/** Settings: a modal with General, Graphics, Audio and Controls tabs. */
export function SettingsPanel({
  locales,
}: {
  locales: readonly { id: string; label: string }[];
}): ReactNode {
  const t = useT();
  const open = useHud((s) => s.settingsOpen);
  const commands = useCommands();
  const [tab, setTab] = useState<Tab>('general');
  const first = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop enter-fade"
      onPointerDown={(e) => e.target === e.currentTarget && commands.setSettingsOpen(false)}
    >
      <section
        className="modal modal--settings enter-scale"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="modal__head">
          <h2 id="settings-title" className="modal__title">
            {t('settings.title')}
          </h2>
          <IconButton
            icon="close"
            label={t('settings.close')}
            tip={false}
            size="sm"
            onClick={() => commands.setSettingsOpen(false)}
          />
        </header>
        <div className="settings">
          <nav className="settings__tabs" role="tablist" aria-orientation="vertical">
            {TABS.map((id, i) => (
              <button
                key={id}
                ref={i === 0 ? first : undefined}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={tab === id}
                aria-controls="settings-panel"
                className={`settings__tab ${tab === id ? 'is-active' : ''}`}
                onClick={() => setTab(id)}
              >
                {t(`settings.tab.${id}`)}
              </button>
            ))}
          </nav>
          <div
            className="settings__panel"
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
          >
            {tab === 'general' && <GeneralTab locales={locales} />}
            {tab === 'graphics' && <GraphicsTab />}
            {tab === 'audio' && <AudioSettings />}
            {tab === 'controls' && <ControlsTab />}
          </div>
        </div>
      </section>
    </div>
  );
}
