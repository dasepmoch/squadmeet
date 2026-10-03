import { useId, type CSSProperties, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import type { DeviceUi, MicProcessingUi, VoiceModeUi } from '../store-media.ts';
import type { PersonUi } from '../store.ts';
import { Icon } from './icons.tsx';
import { Segmented, Slider, Switch } from './ui.tsx';

const VOICE_MODES: readonly VoiceModeUi[] = ['zones', 'global', 'proximity'];
const PROCESSING: readonly (keyof MicProcessingUi)[] = [
  'echoCancellation',
  'noiseSuppression',
  'autoGainControl',
];

/** Input level 0..1 as a row of segments that light up (the mic test). */
export function LevelMeter({ level }: { level: number }): ReactNode {
  const t = useT();
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <span
      className="meter"
      role="meter"
      aria-label={t('voice.level')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      style={{ '--lvl': `${pct}%` } as CSSProperties}
    >
      <span className="meter__fill" />
    </span>
  );
}

/** Device picker; `compact` hides the visible label (a heading names it already). */
export function DeviceSelect(props: {
  label: string;
  devices: readonly DeviceUi[];
  value: string | null;
  onChange: (id: string) => void;
  compact?: boolean;
}): ReactNode {
  const t = useT();
  const id = useId();
  const { label, devices, value, onChange, compact = false } = props;
  const select = (
    <select
      id={id}
      className="input select"
      value={value ?? ''}
      aria-label={compact ? label : undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('voice.systemDefault')}</option>
      {devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.label}
        </option>
      ))}
    </select>
  );
  if (compact) return select;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {select}
    </div>
  );
}

/** Settings: allow the microphone (the live meter and devices show once it is on). */
function MicCheck(): ReactNode {
  const t = useT();
  const c = useCommands();
  const v = useHud((s) => s.voice);
  if (v.mic === 'off' || v.mic === 'starting') {
    return (
      <div className="mic-check mic-check--row">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => c.enableMic()}
          disabled={v.mic === 'starting'}
        >
          <Icon name="mic" size={16} />
          {t(v.mic === 'starting' ? 'voice.asking' : 'voice.test')}
        </button>
        <span className="mic-check__note">{t('voice.listenOnly')}</span>
      </div>
    );
  }
  return (
    <p className="mic-check mic-check--warn" role="status">
      <Icon name="micOff" size={16} />
      {t(`voice.mic.${v.mic}`)}
    </p>
  );
}

/** Settings → Audio: volumes, devices, the mic meter and the processing switches. */
export function AudioSettings(): ReactNode {
  const t = useT();
  const c = useCommands();
  const v = useHud((s) => s.voice);
  const sfx = useHud((s) => s.sfxVolume);
  const ambience = useHud((s) => s.ambienceVolume);
  const processing: MicProcessingUi = {
    echoCancellation: v.echoCancellation,
    noiseSuppression: v.noiseSuppression,
    autoGainControl: v.autoGainControl,
  };
  return (
    <>
      <VolumeRow label={t('settings.sfx')} value={sfx} onChange={(x) => c.setSfxVolume(x)} />
      <VolumeRow
        label={t('settings.ambience')}
        value={ambience}
        onChange={(x) => c.setAmbienceVolume(x)}
      />
      <h3 className="settings__section">{t('voice.input')}</h3>
      {v.mic === 'live' ? (
        <>
          <DeviceSelect
            label={t('voice.input')}
            devices={v.inputs}
            value={v.inputId}
            onChange={(id) => c.setMicDevice(id || null)}
          />
          <LevelMeter level={v.level} />
        </>
      ) : (
        <MicCheck />
      )}
      {v.outputSupported && (
        <DeviceSelect
          label={t('voice.output')}
          devices={v.outputs}
          value={v.outputId}
          onChange={(id) => c.setOutputDevice(id)}
        />
      )}
      {PROCESSING.map((k) => (
        <Switch
          key={k}
          label={t(`voice.${k}`)}
          checked={processing[k]}
          onChange={(on) => c.setMicProcessing({ ...processing, [k]: on })}
        />
      ))}
    </>
  );
}

function VolumeRow(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}): ReactNode {
  const { label, value, onChange } = props;
  const pct = Math.round(value * 100);
  return (
    <div className="set-row set-row--slider">
      <span className="set-row__label">{label}</span>
      <Slider
        label={label}
        value={value}
        min={0}
        max={1}
        step={0.05}
        valueText={`${pct} %`}
        onChange={onChange}
      />
      <span className="set-row__value">{pct}%</span>
    </div>
  );
}

/** Muted mark in the people panel (online people only). */
export function PersonMic({ person }: { person: PersonUi }): ReactNode {
  const t = useT();
  const online = useHud((s) => s.room !== null);
  if (!online || person.isBot || !person.muted) return null;
  return (
    <span className="person__icon person__icon--muted" title={t('people.muted')}>
      <Icon name="micOff" size={16} />
      <span className="sr-only">{t('people.muted')}</span>
    </span>
  );
}

/** Per-person playback volume (0–200 %), only for other people online. */
export function PersonVolume({ person }: { person: PersonUi }): ReactNode {
  const t = useT();
  const c = useCommands();
  if (person.isBot || person.isLocal) return null;
  const label = t('people.volume', { name: person.name });
  const pct = Math.round(person.volume * 100);
  return (
    <div className="person__volume">
      <Icon name={person.volume === 0 ? 'volumeOff' : 'volume'} size={16} />
      <Slider
        label={label}
        value={person.volume}
        min={0}
        max={2}
        step={0.05}
        valueText={`${pct} %`}
        onChange={(v) => c.setPersonVolume(person.id, v)}
      />
      <span className="person__volume-value">{pct}%</span>
    </div>
  );
}

/** Host settings: voice mode, mute everyone, end the current share. */
export function HostVoiceControls(): ReactNode {
  const t = useT();
  const c = useCommands();
  const mode = useHud((s) => s.room?.voice ?? 'zones');
  const presenter = useHud((s) => s.presenter);
  return (
    <>
      <div className="host__group">
        <span className="host__label">{t('host.voice')}</span>
        <Segmented
          label={t('host.voice')}
          value={mode}
          options={VOICE_MODES.map((m) => ({
            id: m,
            label: t(`host.voice.${m}`),
            title: t(`host.voice.${m}Tip`),
          }))}
          onChange={(m) => c.setVoiceMode(m)}
          small
        />
        <p className="host__tip">{t(`host.voice.${mode}Tip`)}</p>
      </div>
      <div className="host__actions">
        <button type="button" className="btn btn--sm" onClick={() => c.muteAll()}>
          <Icon name="micOff" size={16} />
          {t('host.muteAll')}
        </button>
        {presenter && !presenter.self && (
          <button type="button" className="btn btn--sm" onClick={() => c.stopShare()}>
            <Icon name="screen" size={16} />
            {t('host.stopShare', { name: presenter.name })}
          </button>
        )}
      </div>
    </>
  );
}
