export interface LabelInfo {
  name: string;
  isLocal: boolean;
  isBot: boolean;
  /** Accent color of this person (name tag stripe, bubble border). */
  color: string;
}

interface LabelItem {
  root: HTMLDivElement;
  tag: HTMLDivElement;
  /** Speaking badge: three bars whose height follows the voice level (`--lvl`). */
  voice: HTMLSpanElement;
  /** Last level written to `--lvl` (quantized), or -1. */
  level: number;
  name: HTMLSpanElement;
  hand: HTMLSpanElement;
  shield: HTMLSpanElement;
  bubble: HTMLDivElement;
  fx: HTMLDivElement;
  bubbleUntil: number;
  isLocal: boolean;
  x: number;
  y: number;
  scale: number;
  shown: boolean;
}

export type PopTone = 'hit' | 'love' | 'party';

const FAR = 16;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent?.appendChild(e);
  return e;
}

/**
 * Name tags, chat bubbles, raised hands and floating reactions above people's heads. Plain DOM
 * (no React) positioned by the game loop every frame with transforms only, so it never causes
 * layout work or React renders.
 */
export class WorldLabels {
  private readonly root: HTMLDivElement;
  private readonly items = new Map<string, LabelItem>();
  private now = 0;

  /** Inserted into `parent` before `before` (keep it under the HUD layer). */
  constructor(parent: HTMLElement, before: Element | null = null) {
    this.root = el('div', 'world-labels');
    this.root.setAttribute('aria-hidden', 'true');
    parent.insertBefore(this.root, before);
  }

  /** Hides every label (e.g. under Theater Mode). */
  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  upsert(id: string, info: LabelInfo): void {
    let item = this.items.get(id);
    if (!item) {
      const root = el('div', 'wl', this.root);
      const stack = el('div', 'wl__stack', root);
      const fx = el('div', 'wl__fx', stack);
      const bubble = el('div', 'wl__bubble', stack);
      const tag = el('div', 'wl__tag', stack);
      const voice = el('span', 'wl__voice', tag);
      for (let i = 0; i < 3; i++) el('i', '', voice);
      const hand = el('span', 'wl__hand', tag);
      hand.textContent = '✋';
      // "Don't hit me" mark (a shield drawn by CSS, shown with `wl__tag--shield`).
      const shield = el('span', 'wl__shield', tag);
      const name = el('span', 'wl__name', tag);
      // Muted mark (drawn by CSS, shown with `wl__tag--muted`).
      el('span', 'wl__mic', tag);
      item = {
        root,
        tag,
        voice,
        level: -1,
        name,
        hand,
        shield,
        bubble,
        fx,
        bubbleUntil: 0,
        isLocal: info.isLocal,
        x: -1e4,
        y: -1e4,
        scale: 1,
        shown: false,
      };
      this.items.set(id, item);
    }
    item.isLocal = info.isLocal;
    item.name.textContent = info.name;
    item.root.style.setProperty('--wl-color', info.color);
    item.tag.classList.toggle('wl__tag--local', info.isLocal);
    item.tag.classList.toggle('wl__tag--bot', info.isBot);
    item.tag.dataset.bot = info.isBot ? 'AI' : '';
  }

  remove(id: string): void {
    this.items.get(id)?.root.remove();
    this.items.delete(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /** Places a label at a screen point (CSS px) for a head `depth` meters from the camera. */
  place(id: string, x: number, y: number, depth: number, visible: boolean): void {
    const item = this.items.get(id);
    if (!item) return;
    const show = visible && depth < FAR;
    if (show !== item.shown) {
      item.shown = show;
      item.root.style.visibility = show ? 'visible' : 'hidden';
    }
    if (!show) return;
    // Shrinks with distance, but chat bubbles must stay readable across the room.
    const scale = Math.max(0.68, Math.min(1.1, 3.4 / Math.max(0.5, depth)));
    if (
      Math.abs(x - item.x) < 0.3 &&
      Math.abs(y - item.y) < 0.3 &&
      Math.abs(scale - item.scale) < 0.004
    )
      return;
    item.x = x;
    item.y = y;
    item.scale = scale;
    item.root.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    item.root.style.zIndex = String(2000 - Math.round(depth * 20));
    item.root.style.opacity = depth > FAR - 4 ? String(Math.max(0, (FAR - depth) / 4)) : '1';
  }

  /** Shows a chat bubble for a few seconds (longer texts stay longer). */
  bubble(id: string, text: string, seconds = 3 + Math.min(6, text.length / 14)): void {
    const item = this.items.get(id);
    if (!item) return;
    item.bubble.textContent = text;
    item.bubble.classList.remove('is-open');
    // Restart the pop-in animation.
    void item.bubble.offsetWidth;
    item.bubble.classList.add('is-open');
    item.bubbleUntil = this.now + seconds;
  }

  hand(id: string, raised: boolean): void {
    this.items.get(id)?.tag.classList.toggle('wl__tag--hand', raised);
  }

  /** Your own tag in full (name, mic state), the way others see it: the green room. */
  preview(id: string, on: boolean): void {
    this.items.get(id)?.tag.classList.toggle('wl__tag--preview', on);
  }

  /** "Don't hit me" mark on the name tag. */
  shield(id: string, on: boolean): void {
    this.items.get(id)?.tag.classList.toggle('wl__tag--shield', on);
  }

  /** The speaking badge (and ring) and the muted mark on the name tag. */
  voice(id: string, speaking: boolean, muted: boolean): void {
    const tag = this.items.get(id)?.tag;
    if (!tag) return;
    tag.classList.toggle('wl__tag--speaking', speaking);
    tag.classList.toggle('wl__tag--muted', muted && !speaking);
  }

  /**
   * Live voice level 0..1 for the speaking badge's bars. Called every frame; only writes the
   * style when the (quantized) level changes, and only while the person is speaking.
   */
  level(id: string, level: number): void {
    const item = this.items.get(id);
    if (!item || !item.shown) return;
    const speaking = item.tag.classList.contains('wl__tag--speaking');
    const q = speaking ? Math.round(Math.min(1, Math.max(0, level)) * 20) / 20 : 0;
    if (q === item.level) return;
    item.level = q;
    item.voice.style.setProperty('--lvl', q.toFixed(2));
  }

  /** A floating emoji reaction rising from the head. */
  reaction(id: string, emoji: string): void {
    const item = this.items.get(id);
    if (!item) return;
    const r = el('span', 'wl__reaction', item.fx);
    r.textContent = emoji;
    r.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 60)}px`);
    r.addEventListener('animationend', () => r.remove(), { once: true });
  }

  /** Comic text burst ("Bonk!") next to someone's head. */
  pop(id: string, text: string, tone: PopTone): void {
    const item = this.items.get(id);
    if (!item) return;
    const p = el('span', `wl__pop wl__pop--${tone}`, item.fx);
    p.textContent = text;
    p.style.setProperty('--tilt', `${Math.round((Math.random() - 0.5) * 24)}deg`);
    p.addEventListener('animationend', () => p.remove(), { once: true });
  }

  /** Expires chat bubbles; `now` in seconds. */
  update(now: number): void {
    this.now = now;
    for (const item of this.items.values()) {
      if (item.bubbleUntil > 0 && now >= item.bubbleUntil) {
        item.bubbleUntil = 0;
        item.bubble.classList.remove('is-open');
      }
    }
  }

  dispose(): void {
    this.root.remove();
    this.items.clear();
  }
}
