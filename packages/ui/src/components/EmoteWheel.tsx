import { actionAllowed } from '@huddle/shared';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import { EMOTES, REACTIONS } from './icons.tsx';

const HOLD_MS = 280;

/**
 * The quick wheel (Q): emotes around a ring with the quick reactions under it. Click an item, or
 * hold the key, point at an emote and release. Serious rooms keep only quiet gestures.
 */
export function EmoteWheel(): ReactNode {
  const t = useT();
  const c = useCommands();
  const open = useHud((s) => s.emoteWheel);
  const codes = useHud((s) => s.bindings.emoteWheel);
  const mode = useHud((s) => s.room?.mode ?? 'casual');
  const [hover, setHoverState] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const openedAt = useRef(0);
  const setHover = (id: string | null): void => {
    hoverRef.current = id;
    setHoverState(id);
  };

  useEffect(() => {
    if (!open) {
      hoverRef.current = null;
      setHoverState(null);
      return;
    }
    openedAt.current = performance.now();
    const onUp = (e: KeyboardEvent): void => {
      if (!codes.includes(e.code)) return;
      // Hold-and-release picks the emote under the pointer; a quick tap keeps the wheel open.
      if (performance.now() - openedAt.current < HOLD_MS) return;
      const picked = hoverRef.current;
      if (picked) c.emote(picked);
      c.setEmoteWheel(false);
    };
    window.addEventListener('keyup', onUp);
    return () => window.removeEventListener('keyup', onUp);
  }, [open, codes, c]);

  if (!open) return null;
  const n = EMOTES.length;
  const close = (): void => c.setEmoteWheel(false);
  return (
    <div
      className="wheel-backdrop enter-fade"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="wheel enter-scale" role="menu" aria-label={t('dock.emotes')}>
        <div className="wheel__ring" aria-hidden="true" />
        {EMOTES.map((em, i) => (
          <button
            key={em.id}
            type="button"
            role="menuitem"
            className={`wheel__item ${hover === em.id ? 'is-hover' : ''}`}
            style={{ '--a': `${(i / n) * 360}deg` } as CSSProperties}
            disabled={!actionAllowed(mode, em.id)}
            onPointerEnter={() => setHover(em.id)}
            onPointerLeave={() => setHover(hoverRef.current === em.id ? null : hoverRef.current)}
            onFocus={() => setHover(em.id)}
            onClick={() => {
              c.emote(em.id);
              close();
            }}
            aria-label={t(`emote.${em.id}`)}
          >
            <span aria-hidden="true">{em.emoji}</span>
          </button>
        ))}
        <div className="wheel__center" aria-live="polite">
          {hover ? t(`emote.${hover}`) : t(mode === 'serious' ? 'emote.serious' : 'emote.pick')}
        </div>
      </div>
      <div className="reactions surface enter-up" role="toolbar" aria-label={t('reactions.title')}>
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
    </div>
  );
}
