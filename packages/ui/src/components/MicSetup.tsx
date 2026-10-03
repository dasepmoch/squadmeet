import type { CSSProperties, ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import { ECHO_TEST_MS } from '../store-media.ts';
import { Icon } from './icons.tsx';
import { Kbd } from './ui.tsx';
import { DeviceSelect, LevelMeter } from './Voice.tsx';

/**
 * Green room microphone check. Before the browser allows the mic: one button. Then: whether you
 * join with the mic on (M switches it), the device, a live meter (your avatar's mouth and name
 * tag move along), and "hear yourself": a few seconds recorded and played back.
 */
export function MicSetup(): ReactNode {
  const t = useT();
  const c = useCommands();
  const v = useHud((s) => s.voice);
  if (v.mic === 'off' || v.mic === 'starting') {
    return (
      <section className="mic-setup" aria-label={t('voice.input')}>
        <span className="mic-setup__title">{t('voice.input')}</span>
        <button
          type="button"
          className="btn mic-setup__allow"
          onClick={() => c.enableMic()}
          disabled={v.mic === 'starting'}
        >
          <Icon name="mic" size={18} />
          {t(v.mic === 'starting' ? 'voice.asking' : 'voice.test')}
        </button>
        <p className="mic-setup__note">{t('voice.listenOnly')}</p>
      </section>
    );
  }
  if (v.mic !== 'live') {
    return (
      <section className="mic-setup mic-setup--warn" role="status" aria-label={t('voice.input')}>
        <span className="mic-setup__title">
          <Icon name="micOff" size={16} />
          {t(`voice.mic.${v.mic}`)}
        </span>
        <p className="mic-setup__note">{t(`voice.fix.${v.mic}`)}</p>
        <button type="button" className="btn btn--sm" onClick={() => c.enableMic()}>
          {t('app.retry')}
        </button>
      </section>
    );
  }
  const on = !v.muted;
  const echo = v.echo;
  return (
    <section className="mic-setup is-live" aria-label={t('voice.input')}>
      <div className="mic-setup__head">
        <span className="mic-setup__title">{t('voice.input')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={`mic-toggle ${on ? 'is-on' : ''}`}
          onClick={() => c.toggleMute()}
        >
          <Icon name={on ? 'mic' : 'micOff'} size={16} />
          {t(on ? 'voice.joinOn' : 'voice.joinOff')}
          <Kbd>M</Kbd>
        </button>
      </div>
      <DeviceSelect
        label={t('voice.input')}
        devices={v.inputs}
        value={v.inputId}
        onChange={(id) => c.setMicDevice(id || null)}
        compact
      />
      <LevelMeter level={v.level} />
      <div className="mic-setup__row">
        {v.echoSupported && (
          <button
            type="button"
            className={`btn btn--sm echo ${echo !== 'idle' ? `is-${echo}` : ''}`}
            onClick={() => c.testEcho()}
            style={{ '--echo-ms': `${ECHO_TEST_MS}ms` } as CSSProperties}
          >
            <Icon name={echo === 'idle' ? 'ear' : 'stop'} size={16} />
            {t(echo === 'idle' ? 'voice.echo' : 'voice.echoStop')}
          </button>
        )}
        <p className="mic-setup__note" aria-live="polite">
          {t(
            echo === 'recording'
              ? 'voice.echoRecording'
              : echo === 'playing'
                ? 'voice.echoPlaying'
                : 'voice.speakNow',
          )}
        </p>
      </div>
    </section>
  );
}
