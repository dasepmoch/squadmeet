import type { CanvasFactory } from '@huddle/platform';
import { BRAND_COLORS, WORDMARK } from '@huddle/shared';
import { drawBrandMark, drawWordmark } from './brand-canvas.ts';

export interface IdleInfo {
  roomName: string;
  hint: string;
  now: Date;
}

const DISPLAY_FONT = '"Inter Variable", Inter, system-ui, sans-serif';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Draws the display's standby screen (clock, date, room name, how to share) and the presenter's
 * own "You are sharing" placeholder (avoids the hall-of-mirrors effect).
 */
export class ScreenCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastKey = '';

  constructor(factory: CanvasFactory, width = 1920, height = 1080) {
    this.canvas = factory.create(width, height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  /** Returns true when pixels changed (caller flags the texture for upload). */
  drawIdle(info: IdleInfo): boolean {
    const hh = info.now.getHours().toString().padStart(2, '0');
    const mm = info.now.getMinutes().toString().padStart(2, '0');
    const key = `idle:${info.roomName}:${info.hint}:${hh}:${mm}`;
    if (key === this.lastKey) return false;
    this.lastKey = key;
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0B1426');
    bg.addColorStop(0.6, '#13233F');
    bg.addColorStop(1, '#1B3357');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // Soft light blooms, like a premium lock screen.
    for (const [x, y, r, c] of [
      [0.82, 0.18, 0.55, 'rgba(76,132,255,0.22)'],
      [0.12, 0.92, 0.5, 'rgba(46,196,182,0.14)'],
    ] as const) {
      const g = ctx.createRadialGradient(w * x, h * y, 0, w * x, h * y, w * r);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const left = w * 0.08;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `200 ${Math.round(h * 0.26)}px ${DISPLAY_FONT}`;
    ctx.fillText(`${hh}:${mm}`, left - h * 0.012, h * 0.47);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = `400 ${Math.round(h * 0.045)}px ${DISPLAY_FONT}`;
    const d = info.now;
    ctx.fillText(
      `${DAYS[d.getDay()] ?? ''}, ${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`,
      left,
      h * 0.56,
    );
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(left, h * 0.64, w * 0.84, 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 ${Math.round(h * 0.05)}px ${DISPLAY_FONT}`;
    ctx.fillText(info.roomName, left, h * 0.74);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = `400 ${Math.round(h * 0.032)}px ${DISPLAY_FONT}`;
    ctx.fillText(info.hint, left, h * 0.81);
    // The logo, top right.
    const cap = Math.round(h * 0.03);
    const wordW = (WORDMARK.width * cap) / 75;
    const markSize = cap * 2.1;
    const base = h * 0.12;
    const wordX = w - left - wordW;
    drawBrandMark(ctx, wordX - markSize * 1.08, base - cap / 2 - markSize * 0.5, markSize);
    drawWordmark(ctx, wordX, base, cap, { squid: '#FFFFFF', meet: BRAND_COLORS.aqua });
    return true;
  }

  drawSelfShare(title: string, subtitle: string): boolean {
    const key = `self:${title}:${subtitle}`;
    if (key === this.lastKey) return false;
    this.lastKey = key;
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0E1729';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(92,150,255,0.9)';
    ctx.lineWidth = h * 0.012;
    const s = h * 0.16;
    ctx.strokeRect(w / 2 - s * 0.8, h * 0.3 - s * 0.45, s * 1.6, s * 0.95);
    ctx.fillStyle = 'rgba(92,150,255,0.9)';
    ctx.fillRect(w / 2 - s * 0.3, h * 0.3 + s * 0.6, s * 0.6, h * 0.012);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(h * 0.07)}px ${DISPLAY_FONT}`;
    ctx.fillText(title, w / 2, h * 0.58);
    ctx.fillStyle = 'rgba(255,255,255,0.66)';
    ctx.font = `400 ${Math.round(h * 0.036)}px ${DISPLAY_FONT}`;
    ctx.fillText(subtitle, w / 2, h * 0.68);
    return true;
  }
}
