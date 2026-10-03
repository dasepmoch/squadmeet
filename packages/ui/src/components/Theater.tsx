import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import { Icon, REACTIONS } from './icons.tsx';
import { ChatPanel } from './SidePanels.tsx';
import { IconButton, Slider, useDismiss } from './ui.tsx';

const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
/** The bars fade out after this long without the pointer moving. */
const IDLE_MS = 2600;

interface View {
  zoom: number;
  x: number;
  y: number;
}

const HOME: View = { zoom: 1, x: 0, y: 0 };

/** Keeps a zoomed picture covering the stage: panning never shows empty edges. */
function clampView(v: View, width: number, height: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
  const mx = ((zoom - 1) * width) / 2;
  const my = ((zoom - 1) * height) / 2;
  return { zoom, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
}

/** Who presents and who has a hand up, in a pill over the picture. */
function TheaterInfo(): ReactNode {
  const t = useT();
  const presenter = useHud((s) => s.presenter);
  const people = useHud((s) => s.people);
  const hands = people
    .filter((p) => p.handOrder !== null)
    .sort((a, b) => (a.handOrder ?? 0) - (b.handOrder ?? 0));
  return (
    <div className="theater__info surface" role="status">
      <span className="theater__presenter">
        {presenter && <span className="share-bar__live" aria-hidden="true" />}
        {presenter
          ? presenter.self
            ? t('theater.youPresent')
            : t('theater.presenter', { name: presenter.name })
          : t('theater.title')}
      </span>
      {hands.length > 0 && (
        <ol className="theater__hands" aria-label={t('people.queue')}>
          {hands.slice(0, 3).map((p) => (
            <li key={p.id}>
              <span aria-hidden="true">✋</span>
              {p.isLocal ? t('people.you') : p.name}
            </li>
          ))}
          {hands.length > 3 && <li>+{hands.length - 3}</li>}
        </ol>
      )}
    </div>
  );
}

interface Float {
  id: number;
  emoji: string;
  x: number;
}

/**
 * Theater Mode: the shared screen as a crisp DOM video over everything. Wheel or the buttons
 * zoom (up to 4×), dragging pans a zoomed picture, double-click toggles 2×. The bars hide while
 * you watch; the chat, a raised hand and reactions stay one click away.
 */
export function Theater(): ReactNode {
  const t = useT();
  const c = useCommands();
  const video = useHud((s) => s.theater);
  const volume = useHud((s) => s.screenVolume);
  const fullscreen = useHud((s) => s.fullscreen);
  const panel = useHud((s) => s.panel);
  const popover = useHud((s) => s.popover);
  const unread = useHud((s) => s.unread);
  const handRaised = useHud((s) => s.handRaised);
  const [fill, setFill] = useState(false);
  const [view, setView] = useState<View>(HOME);
  const [idle, setIdle] = useState(false);
  const [floats, setFloats] = useState<Float[]>([]);
  const stage = useRef<HTMLDivElement | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const idleTimer = useRef(0);
  const overBar = useRef(false);
  const floatSeq = useRef(0);
  const reactOpen = popover === 'react';
  useDismiss(reactOpen, bottom, () => c.setPopover(null));

  const wake = useCallback((): void => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(!overBar.current), IDLE_MS);
  }, []);
  useEffect(() => {
    const host = stage.current;
    if (!video || !host) return;
    host.appendChild(video);
    video.classList.add('theater__video');
    void video.play().catch(() => undefined);
    setView(HOME);
    wake();
    return () => {
      window.clearTimeout(idleTimer.current);
      video.style.transform = '';
      video.remove();
    };
  }, [video, wake]);
  useEffect(() => {
    if (!video) return;
    video.style.transform =
      view.zoom === 1 ? '' : `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  }, [video, view]);
  if (!video) return null;

  /** Zooms by `factor` keeping the point under (clientX, clientY) in place. */
  const zoomAt = (factor: number, clientX?: number, clientY?: number): void => {
    const host = stage.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const px = (clientX ?? r.left + r.width / 2) - (r.left + r.width / 2);
    const py = (clientY ?? r.top + r.height / 2) - (r.top + r.height / 2);
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * factor));
      const k = zoom / v.zoom;
      return clampView({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, r.width, r.height);
    });
  };
  const onWheel = (e: WheelEvent): void =>
    zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX, e.clientY);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (view.zoom === 1 || e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    const host = stage.current;
    if (!d || d.id !== e.pointerId || !host) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    const r = host.getBoundingClientRect();
    setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, r.width, r.height));
  };
  const endDrag = (): void => {
    drag.current = null;
  };
  const react = (emoji: string): void => {
    c.react(emoji);
    const id = ++floatSeq.current;
    setFloats((f) => [...f.slice(-6), { id, emoji, x: Math.round((Math.random() - 0.5) * 80) }]);
  };
  const zoomed = view.zoom > 1;
  const hidden = idle && panel !== 'chat' && !reactOpen;
  return (
    <div
      className={`theater ${fill ? 'theater--fill' : ''} ${hidden ? 'is-idle' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('theater.title')}
      onPointerMove={wake}
      onKeyDown={wake}
    >
      <div
        className={`theater__stage ${zoomed ? 'is-zoomed' : ''}`}
        ref={stage}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => (zoomed ? setView(HOME) : zoomAt(2, e.clientX, e.clientY))}
      />
      <div className="theater__top theater__chrome">
        <button type="button" className="btn theater__back" onClick={() => c.closeTheater()}>
          <Icon name="arrowLeft" size={18} />
          {t('theater.exit')}
          <kbd className="kbd">Esc</kbd>
        </button>
        <TheaterInfo />
      </div>
      <div className="theater__floats" aria-hidden="true">
        {floats.map((f) => (
          <span
            key={f.id}
            className="theater__float"
            style={{ '--x': `${f.x}px` } as CSSProperties}
            onAnimationEnd={() => setFloats((all) => all.filter((x) => x.id !== f.id))}
          >
            {f.emoji}
          </span>
        ))}
      </div>
      <div className="theater__bottom theater__chrome" ref={bottom}>
        {reactOpen && (
          <div
            className="popover popover--bar surface enter-pop"
            role="dialog"
            aria-label={t('bar.react')}
          >
            <div className="reactions" role="group" aria-label={t('reactions.title')}>
              {REACTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="reaction"
                  onClick={() => react(r)}
                  aria-label={r}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          className="cbar__inner surface"
          onPointerEnter={() => (overBar.current = true)}
          onPointerLeave={() => (overBar.current = false)}
        >
          <IconButton
            icon="minus"
            label={t('theater.zoomOut')}
            disabled={!zoomed}
            onClick={() => zoomAt(1 / ZOOM_STEP)}
          />
          <button
            type="button"
            className="theater__zoom"
            onClick={() => setView(HOME)}
            aria-label={t('theater.resetZoom')}
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <IconButton
            icon="plus"
            label={t('theater.zoomIn')}
            disabled={view.zoom >= MAX_ZOOM}
            onClick={() => zoomAt(ZOOM_STEP)}
          />
          {volume !== null && (
            <span className="theater__volume">
              <Icon name={volume === 0 ? 'volumeOff' : 'volume'} size={18} />
              <Slider
                label={t('theater.volume')}
                value={volume}
                min={0}
                max={2}
                step={0.05}
                valueText={`${Math.round(volume * 100)} %`}
                onChange={(v) => c.setScreenVolume(v)}
              />
            </span>
          )}
          <span className="cbar__sep" aria-hidden="true" />
          <IconButton
            icon="fill"
            label={t(fill ? 'theater.fit' : 'theater.fill')}
            pressed={fill}
            tone={fill ? 'on' : null}
            onClick={() => setFill((f) => !f)}
          />
          <IconButton
            icon={fullscreen ? 'collapse' : 'expand'}
            label={t(fullscreen ? 'theater.exitFullscreen' : 'theater.fullscreen')}
            pressed={fullscreen}
            tone={fullscreen ? 'on' : null}
            onClick={() => c.toggleFullscreen()}
          />
          <span className="cbar__sep" aria-hidden="true" />
          <IconButton
            icon="hand"
            label={t(handRaised ? 'dock.lowerHand' : 'dock.raiseHand')}
            pressed={handRaised}
            tone={handRaised ? 'warn' : null}
            onClick={() => c.raiseHand()}
          />
          <IconButton
            icon="smile"
            label={t('bar.react')}
            expanded={reactOpen}
            tone={reactOpen ? 'on' : null}
            onClick={() => c.setPopover(reactOpen ? null : 'react')}
          />
          <IconButton
            icon="chat"
            label={t('dock.chat')}
            pressed={panel === 'chat'}
            tone={panel === 'chat' ? 'on' : null}
            badge={panel === 'chat' ? 0 : unread}
            onClick={() => c.setPanel(panel === 'chat' ? null : 'chat')}
          />
        </div>
      </div>
      <ChatPanel compact />
    </div>
  );
}
