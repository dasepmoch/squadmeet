import { useId, type CSSProperties, type ReactNode } from 'react';
import { BRAND_NAME, MARK, WORDMARK } from '@huddle/shared';

export { BRAND_NAME };

/** SVG ids must be unique per instance (the mark shows up several times on a page). */
function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/**
 * The squid: a glossy mantle with swept fins, big eyes, four arms. `animated` makes it swim
 * (the body bobs, the arms flex in a wave, it blinks) for the intro.
 */
export function LogoMark({
  size = 24,
  animated = false,
}: {
  size?: number;
  animated?: boolean;
}): ReactNode {
  const id = useSvgId('mk');
  return (
    <svg
      className={`mark ${animated ? 'mark--animated' : ''}`}
      viewBox={`0 0 ${MARK.size} ${MARK.size}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}b`} x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#8AF9E6" />
          <stop offset="0.45" stopColor="#3FE6C8" />
          <stop offset="1" stopColor="#14B193" />
        </linearGradient>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22C9AA" />
          <stop offset="1" stopColor="#0F9C83" />
        </linearGradient>
        <radialGradient id={`${id}s`} cx="0.32" cy="0.28" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="mark__swim">
        <g fill="none" stroke={`url(#${id}a)`} strokeWidth={MARK.armWidth} strokeLinecap="round">
          {MARK.arms.map((d, i) => (
            <path
              key={d}
              className="mark__arm"
              d={d}
              // Left arms swing left, right ones right.
              style={{ '--i': i, '--dir': i < 2 ? 1 : -1 } as CSSProperties}
            />
          ))}
        </g>
        <path d={MARK.mantle} fill={`url(#${id}b)`} />
        <path className="mark__fins" d={MARK.fins} fill={`url(#${id}b)`} />
        <path d={MARK.mantle} fill={`url(#${id}s)`} />
        <g className="mark__eyes">
          {MARK.eyes.map((e) => (
            <ellipse key={e.cx} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill="#0A0C11" />
          ))}
          {MARK.glints.map((g) => (
            <circle key={g.cx} cx={g.cx} cy={g.cy} r={g.r} fill="#fff" />
          ))}
        </g>
      </g>
    </svg>
  );
}

const PAD = 2;
const BOX_W = WORDMARK.width + PAD * 2;
const BOX_H = WORDMARK.bottom - WORDMARK.top + PAD * 2;

/**
 * The lettering, drawn (not typed): "Squid" in the text color, "Meet" and the ink-drop dot in
 * the accent. `height` is the whole box (drop to descender). Animated, the letters rise in one by
 * one and the drop falls onto the i last.
 */
export function Wordmark({
  height = 20,
  animated = false,
}: {
  height?: number;
  animated?: boolean;
}): ReactNode {
  return (
    <svg
      className={`wordmark ${animated ? 'wordmark--animated' : ''}`}
      viewBox={`${-PAD} ${WORDMARK.top - PAD} ${BOX_W} ${BOX_H}`}
      width={(height * BOX_W) / BOX_H}
      height={height}
      role="img"
      aria-label={BRAND_NAME}
      focusable="false"
    >
      {WORDMARK.glyphs.map((d, i) => (
        <path
          key={d}
          className={i < WORDMARK.squidGlyphs ? 'wordmark__squid' : 'wordmark__meet'}
          d={d}
          style={{ '--i': i } as CSSProperties}
        />
      ))}
      <path className="wordmark__drop" d={WORDMARK.drop} />
    </svg>
  );
}

/** Mark and lettering side by side; `size` is the mark's. */
export function Brand({ size = 28 }: { size?: number }): ReactNode {
  return (
    <span className="brand">
      <LogoMark size={size} />
      <Wordmark height={Math.round(size * 0.64)} />
    </span>
  );
}
