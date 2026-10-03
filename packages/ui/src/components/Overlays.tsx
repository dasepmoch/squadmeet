import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import { dismissToast, type HudStore, type Toast } from '../store.ts';
import { HeldGlyph } from './icons.tsx';
import { IconButton, useExit } from './ui.tsx';

export function ContextLostBanner(): ReactNode {
  const t = useT();
  const lost = useHud((s) => s.contextLost);
  if (!lost) return null;
  return (
    <div className="banner surface enter-down" role="status">
      <span className="spinner" aria-hidden="true" />
      {t('app.contextLost')}
    </div>
  );
}

/** "E Sit" over the bar while something interactive is in reach (a button on touch). */
export function InteractionPrompt(): ReactNode {
  const t = useT();
  const prompt = useHud((s) => s.prompt);
  const touch = useHud((s) => s.touch);
  const commands = useCommands();
  if (!prompt) return null;
  const label = t(prompt.labelKey);
  if (touch) {
    return (
      <button
        type="button"
        className="btn btn--primary prompt-touch enter-up"
        onPointerDown={() => commands.pressAction('interact', true)}
        onPointerUp={() => commands.pressAction('interact', false)}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="prompt surface enter-up" aria-live="polite">
      <kbd className="kbd kbd--accent">E</kbd>
      <span>{label}</span>
    </div>
  );
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What is in your hand, with Use (X) and Put away. */
export function HeldChip(): ReactNode {
  const t = useT();
  const c = useCommands();
  const held = useHud((s) => s.play.held);
  if (!held) return null;
  const item = t(`hold.${held}`);
  const plane = held === 'plane';
  return (
    <div className="held surface enter-up" role="group" aria-label={t('hold.inHand', { item })}>
      <HeldGlyph item={held} />
      <span className="held__name">{capitalize(item)}</span>
      <button
        type="button"
        className="btn btn--sm btn--soft"
        onClick={() => c.useItem()}
        aria-label={t(plane ? 'hold.throwIt' : 'hold.use', { item })}
      >
        <kbd className="kbd">X</kbd>
        {t(plane ? 'held.throw' : 'held.use')}
      </button>
      <IconButton
        icon="close"
        size="sm"
        label={t('hold.putAway', { item })}
        onClick={() => c.holdItem(null)}
      />
    </div>
  );
}

export function ScreenTooltip(): ReactNode {
  const t = useT();
  const hover = useHud((s) => s.hoverScreen);
  if (!hover) return null;
  return (
    <div className="screen-tooltip" role="tooltip">
      {t('screen.clickToExpand')}
    </div>
  );
}

function ToastItem({ toast, store }: { toast: Toast; store: HudStore }): ReactNode {
  const t = useT();
  useEffect(() => {
    const handle = window.setTimeout(() => dismissToast(store, toast.id), 3400);
    return () => window.clearTimeout(handle);
  }, [toast.id, store]);
  return (
    <li className={`toast toast--${toast.tone} surface enter-down`}>
      <span className="toast__dot" aria-hidden="true" />
      {t(toast.textKey, toast.vars)}
    </li>
  );
}

export function Toasts({ store }: { store: HudStore }): ReactNode {
  const toasts = useHud((s) => s.toasts);
  return (
    <ul className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} store={store} />
      ))}
    </ul>
  );
}

type TipKind = 'stand' | 'seat';
/** Keys starting with `keys.` are mouse words (translated); the rest are key names. */
const TIPS: Record<TipKind, readonly { keys: readonly string[]; label: string }[]> = {
  stand: [
    { keys: ['W', 'A', 'S', 'D'], label: 'tips.move' },
    { keys: ['keys.drag'], label: 'tips.look' },
    { keys: ['keys.click'], label: 'tips.walk' },
    { keys: ['G'], label: 'tips.play' },
    { keys: ['Q'], label: 'tips.emotes' },
  ],
  seat: [
    { keys: ['E'], label: 'tips.stand' },
    { keys: ['keys.drag'], label: 'tips.look' },
    { keys: ['F'], label: 'tips.freeLook' },
    { keys: ['T'], label: 'tips.theater' },
  ],
};
const SHOW_AFTER: Record<TipKind, number> = { stand: 1400, seat: 600 };
const HIDE_AFTER = 13000;

/**
 * A small "how to" card, bottom left: once when you walk in, once the first time you sit. It
 * fades away by itself (or with the close button).
 */
export function CoachTips(): ReactNode {
  const t = useT();
  const seated = useHud((s) => s.seated);
  const touch = useHud((s) => s.touch);
  const kind: TipKind = seated ? 'seat' : 'stand';
  const done = useRef<Record<TipKind, boolean>>({ stand: false, seat: false });
  const last = useRef<TipKind>('stand');
  const [shown, setShown] = useState<TipKind | null>(null);
  useEffect(() => {
    if (touch || done.current[kind]) return;
    const show = window.setTimeout(() => {
      // A new card retires the one it replaces (sitting down mid-way, for example).
      if (last.current !== kind) done.current[last.current] = true;
      last.current = kind;
      setShown(kind);
    }, SHOW_AFTER[kind]);
    const hide = window.setTimeout(() => {
      done.current[kind] = true;
      setShown((s) => (s === kind ? null : s));
    }, SHOW_AFTER[kind] + HIDE_AFTER);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [kind, touch]);
  const { mounted, leaving } = useExit(shown !== null, 240);
  if (!mounted) return null;
  const rows = TIPS[shown ?? last.current];
  const dismiss = (): void => {
    done.current[last.current] = true;
    setShown(null);
  };
  return (
    <aside
      className={`coach surface enter-up ${leaving ? 'is-leaving' : ''}`}
      aria-label={t('tips.title')}
    >
      <header className="coach__head">
        <span>{t('tips.title')}</span>
        <IconButton
          icon="close"
          size="sm"
          tip={false}
          label={t('tips.dismiss')}
          onClick={dismiss}
        />
      </header>
      <ul className="coach__list">
        {rows.map((r) => (
          <li key={r.label}>
            <span className="coach__keys">
              {r.keys.map((k) => (
                <kbd key={k} className="kbd">
                  {k.startsWith('keys.') ? t(k) : k}
                </kbd>
              ))}
            </span>
            <span className="coach__label">{t(r.label)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
