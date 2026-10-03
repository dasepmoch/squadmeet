import type { ReactNode } from 'react';
import { useHud, useT } from '../context.tsx';

function fmt(n: number, digits = 0): string {
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

/** F3 overlay: frame timing, GPU budgets, memory and (when connected) network/RTC health. */
export function DebugOverlay(): ReactNode {
  const t = useT();
  const open = useHud((s) => s.debugOpen);
  const d = useHud((s) => s.debug);
  if (!open) return null;
  const offline = t('debug.offline');
  const rows: [string, string][] = [
    [t('debug.fps'), fmt(d.fps, 0)],
    [t('debug.frame'), `${fmt(d.frameMs, 1)} ms`],
    [t('debug.render'), `${fmt(d.renderMs, 2)} ms`],
    [t('debug.drawCalls'), fmt(d.drawCalls)],
    [t('debug.triangles'), fmt(d.triangles)],
    [t('debug.geometries'), fmt(d.geometries)],
    [t('debug.textures'), fmt(d.textures)],
    [t('debug.programs'), fmt(d.programs)],
    [t('debug.memory'), d.heapMb === null ? 'n/a' : `${fmt(d.heapMb, 0)} MB`],
    [t('debug.resolution'), d.resolution],
    [t('debug.quality'), d.quality],
    [t('debug.decals'), fmt(d.decals)],
    [t('debug.camera'), d.camera],
    [t('debug.ping'), d.pingMs === null ? offline : `${fmt(d.pingMs, 0)} ms`],
    [t('debug.packetLoss'), d.packetLoss === null ? offline : `${fmt(d.packetLoss * 100, 1)} %`],
    [t('debug.bitrate'), d.bitrateKbps === null ? offline : `${fmt(d.bitrateKbps, 0)} kbps`],
  ];
  return (
    <aside className="debug" aria-label={t('debug.title')}>
      <h2>{t('debug.title')}</h2>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="debug__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="debug__gpu" title={d.gpu}>
        {t('debug.gpu')}: {d.gpu}
      </p>
      {d.peers.length > 0 && (
        <>
          <h3>{t('debug.peers')}</h3>
          <ul>
            {d.peers.map((p) => (
              <li key={p.id}>
                {p.id.slice(0, 6)} · {p.state}
              </li>
            ))}
          </ul>
        </>
      )}
      {d.audio.length > 0 && (
        <>
          <h3>{t('debug.audio')}</h3>
          <ul>
            {d.audio.map((a) => (
              <li key={a.id} className="debug__meter">
                <span>{a.id.slice(0, 6)}</span>
                <meter min={0} max={1} value={a.level} />
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
