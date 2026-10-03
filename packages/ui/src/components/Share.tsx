import type { ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import type { ShareHintUi } from '../store-media.ts';
import { Segmented } from './ui.tsx';

const HINTS: readonly ShareHintUi[] = ['detail', 'motion'];

/**
 * The persistent "you are presenting" bar: what kind of content (sharp text or smooth motion),
 * Stop, and requests from people who would like the screen next.
 */
export function ShareBar(): ReactNode {
  const t = useT();
  const c = useCommands();
  const sharing = useHud((s) => s.sharing);
  const hint = useHud((s) => s.shareHint);
  const requests = useHud((s) => s.presentRequests);
  if (!sharing) return null;
  return (
    <>
      <div className="share-bar surface enter-down" role="status">
        <span className="share-bar__live" aria-hidden="true" />
        <span className="share-bar__title">{t('share.bar')}</span>
        <Segmented
          label={t('share.hint')}
          value={hint}
          options={HINTS.map((h) => ({
            id: h,
            label: t(`share.hint.${h}`),
            title: t(`share.hint.${h}Tip`),
          }))}
          onChange={(h) => c.setShareHint(h)}
          small
        />
        <button type="button" className="btn btn--sm btn--danger" onClick={() => c.toggleShare()}>
          {t('share.stop')}
        </button>
      </div>
      {requests.map((r) => (
        <div key={r.id} className="share-request surface enter-down" role="alert">
          <span className="share-request__text">{t('share.request', { name: r.name })}</span>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => c.answerPresentRequest(r.id, true)}
          >
            {t('share.handOver')}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => c.answerPresentRequest(r.id, false)}
          >
            {t('share.keep')}
          </button>
        </div>
      ))}
    </>
  );
}
