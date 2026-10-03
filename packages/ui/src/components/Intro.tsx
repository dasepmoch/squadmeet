import type { ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import { LogoMark, Wordmark } from './Brand.tsx';

/**
 * The intro while the room loads: the squid swims up out of the dark, the lettering rises in
 * glyph by glyph and the ink drop lands on the i, a thin progress line fills. When the room is
 * ready, a widening circle opens the dark onto the live room behind.
 */
export function LoadingScreen({ leaving }: { leaving: boolean }): ReactNode {
  const t = useT();
  const key = useHud((s) => s.loadingKey);
  const progress = useHud((s) => s.loadingProgress);
  const pct = leaving ? 100 : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div
      className={`intro ${leaving ? 'is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!leaving}
    >
      <div className="intro__glow" aria-hidden="true" />
      <div className="intro__bubbles" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} />
        ))}
      </div>
      <div className="intro__center">
        <span className="intro__mark">
          <LogoMark size={92} animated />
        </span>
        <h1 className="intro__name">
          <Wordmark height={50} animated />
        </h1>
        <p className="intro__tagline">{t('app.tagline')}</p>
        <div
          className="intro__progress"
          role="progressbar"
          aria-label={t(key)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span className="intro__bar" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <p className="intro__step">{t(key)}</p>
      </div>
    </div>
  );
}

export function ErrorScreen(): ReactNode {
  const t = useT();
  const phase = useHud((s) => s.phase);
  const message = useHud((s) => s.errorMessage);
  const commands = useCommands();
  const unsupported = phase === 'unsupported';
  return (
    <div className="intro intro--error" role="alert">
      <div className="intro__glow" aria-hidden="true" />
      <div className="intro__center">
        <LogoMark size={56} />
        <h1 className="intro__title">
          {t(unsupported ? 'app.unsupportedTitle' : 'app.errorTitle')}
        </h1>
        <p className="intro__body">{unsupported ? t('app.unsupportedBody') : message}</p>
        {!unsupported && (
          <button type="button" className="btn btn--primary" onClick={() => commands.retry()}>
            {t('app.retry')}
          </button>
        )}
      </div>
    </div>
  );
}
