import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { useT } from '../context.tsx';
import { Icon, type IconName } from './icons.tsx';

/** Where a tooltip sits relative to its button. */
export type TipSide = 'top' | 'bottom' | 'bottom-end';

export interface IconButtonProps {
  icon: IconName;
  /** Accessible name and tooltip text. */
  label: string;
  onClick?: () => void;
  /** Keyboard shortcut shown in the tooltip. */
  kbd?: string;
  /** Toggle buttons: aria-pressed. */
  pressed?: boolean;
  /** Menu triggers: aria-expanded (also hides the tooltip while the menu is open). */
  expanded?: boolean;
  controls?: string;
  /** State tint: on (accent), off (muted / deafened), warn (hand up), danger (leave). */
  tone?: 'on' | 'off' | 'warn' | 'danger' | null;
  disabled?: boolean;
  badge?: number;
  size?: 'sm' | 'md';
  tip?: TipSide | false;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Square icon button with an optional tooltip (label and shortcut) and a count badge. */
export function IconButton(props: IconButtonProps): ReactNode {
  const {
    icon,
    label,
    onClick,
    kbd,
    pressed,
    expanded,
    controls,
    tone,
    disabled = false,
    badge = 0,
    size = 'md',
    tip = 'top',
    className = '',
    style,
    children,
  } = props;
  const button = (
    <button
      type="button"
      className={`ibtn ibtn--${size} ${tone ? `is-${tone}` : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      style={style}
    >
      <Icon name={icon} size={size === 'sm' ? 18 : 20} />
      {badge > 0 && <span className="ibtn__badge">{badge > 9 ? '9+' : badge}</span>}
      {children}
    </button>
  );
  if (tip === false) return button;
  return (
    <span className={`tip-host tip-host--${tip}`} data-open={expanded ? 'true' : undefined}>
      {button}
      <span className="tip" aria-hidden="true">
        {label}
        {kbd && <kbd className="kbd kbd--tip">{kbd}</kbd>}
      </span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return <kbd className="kbd">{children}</kbd>;
}

/** A labelled on/off switch row (a checkbox with the switch role). */
export function Switch(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}): ReactNode {
  const { label, hint, checked, onChange, disabled = false } = props;
  return (
    <label className={`switch-row ${disabled ? 'is-disabled' : ''}`}>
      <span className="switch-row__text">
        <span className="switch-row__label">{label}</span>
        {hint && <span className="switch-row__hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  title?: string;
}

/** One-of-a-few choice as a segmented control. */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  small?: boolean;
}): ReactNode {
  const { label, value, options, onChange, small = false } = props;
  return (
    <div className={`seg ${small ? 'seg--sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={`seg__item ${value === o.id ? 'is-active' : ''}`}
          onClick={() => onChange(o.id)}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Range input with a filled track. */
export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  valueText?: string;
  className?: string;
}): ReactNode {
  const { label, value, min, max, step, onChange, valueText, className = '' } = props;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={`slider ${className}`}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={valueText}
      style={{ '--fill': `${pct}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** Up to two initials, safe for emoji and accents (whole code points). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(parts[0] ?? '?')[0] ?? '?';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1] ?? '')[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** A person as a colored circle with initials; rings while they speak. */
export function Avatar(props: {
  name: string;
  color: string;
  size?: number;
  speaking?: boolean;
}): ReactNode {
  const { name, color, size = 28, speaking = false } = props;
  return (
    <span
      className={`avatar ${speaking ? 'is-speaking' : ''}`}
      style={{ '--c': color, '--s': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/** Staggered entrance: the delay of an `enter-*` animation. */
export const enterDelay = (ms: number): CSSProperties => ({ '--d': `${ms}ms` }) as CSSProperties;

/** Three bars that bounce while someone talks (the speaking indicator). */
export function VoiceBars({ className = '' }: { className?: string }): ReactNode {
  return (
    <span className={`vbars ${className}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Right-side panel with a title row and a close button. */
export function Sheet(props: {
  title: string;
  meta?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}): ReactNode {
  const t = useT();
  const { title, meta, onClose, children, footer, className = '' } = props;
  return (
    <aside className={`sheet surface enter-right ${className}`} aria-label={title}>
      <header className="sheet__head">
        <h2 className="sheet__title">
          {title}
          {meta !== undefined && <span className="sheet__meta">{meta}</span>}
        </h2>
        <IconButton
          icon="close"
          label={t('settings.close')}
          onClick={onClose}
          size="sm"
          tip={false}
        />
      </header>
      <div className="sheet__body">{children}</div>
      {footer && <footer className="sheet__foot">{footer}</footer>}
    </aside>
  );
}

/** Calls `onClose` when a pointer goes down outside `ref` while `open`. */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const el = ref.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      close.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, ref]);
}

/**
 * Keeps something mounted for `ms` after `show` turns false, so it can play an exit animation.
 * Returns whether to render it and whether it is leaving.
 */
export function useExit(show: boolean, ms: number): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    const handle = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(handle);
  }, [show, ms]);
  return { mounted: show || mounted, leaving: !show && mounted };
}
