import { drawBrandMark, drawWordmark } from '@huddle/render';
import { BRAND_COLORS } from '@huddle/shared';

/**
 * Placeholder "presentation" for the big screen: an animated slide deck drawn on a canvas and
 * exposed as a MediaStream via `captureStream`, so it exercises the exact same video-texture path
 * (and Theater Mode) as a real screen share.
 */
const W = 1280;
const H = 720;
const SLIDE_SECONDS = 7;
const INK = '#1B1D29';
const MUTED = '#6B7080';
const BRAND = BRAND_COLORS.deep;
const COLORS = ['#13B39A', '#3B82F6', '#F59E0B', '#F43F5E', '#8B5CF6'];
/** Slide titles in the brand's display face (Inter until it has loaded). */
const DISPLAY = 'Unbounded, "Inter Variable", Inter, system-ui, sans-serif';
const BODY = '"Inter Variable", Inter, system-ui, sans-serif';

interface Slide {
  title: string;
  kicker: string;
  draw(ctx: CanvasRenderingContext2D, t: number): void;
}

const appear = (t: number, at: number): number => Math.min(1, Math.max(0, (t - at) * 2.2));
const ease = (x: number): number => 1 - (1 - x) ** 3;

function bullets(ctx: CanvasRenderingContext2D, t: number): void {
  const items = [
    'Ship the 12F boardroom',
    'Office-mates that throw tomatoes',
    'Big-screen sharing in under 1 s',
    'More rubber ducks',
  ];
  items.forEach((item, i) => {
    const a = ease(appear(t, 0.4 + i * 0.55));
    ctx.globalAlpha = a;
    const y = 250 + i * 104;
    ctx.fillStyle = COLORS[i] ?? BRAND;
    ctx.beginPath();
    ctx.roundRect(110, y - 28, 56, 56, 16);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 30px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), 138, y + 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = `600 46px ${BODY}`;
    ctx.fillText(item, 196 + (1 - a) * 36, y + 2);
  });
  ctx.globalAlpha = 1;
}

function chart(ctx: CanvasRenderingContext2D, t: number): void {
  const bars: [string, number][] = [
    ['Focus', 0.62],
    ['Fun', 0.86],
    ['Coffee', 0.74],
    ['Ducks', 0.97],
    ['Tomatoes', 0.55],
  ];
  const base = 600;
  ctx.strokeStyle = '#E6E8F0';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const y = base - i * 90;
    ctx.beginPath();
    ctx.moveTo(130, y);
    ctx.lineTo(1150, y);
    ctx.stroke();
  }
  bars.forEach(([label, v], i) => {
    const grow = ease(Math.min(1, Math.max(0, (t - 0.3 - i * 0.18) / 1.2)));
    const h = v * 360 * grow;
    const x = 175 + i * 196;
    ctx.fillStyle = COLORS[i] ?? BRAND;
    ctx.beginPath();
    ctx.roundRect(x, base - h, 120, h, [18, 18, 4, 4]);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = `600 30px ${BODY}`;
    ctx.textAlign = 'center';
    ctx.globalAlpha = grow;
    ctx.fillText(`${Math.round(v * 100 * grow)}%`, x + 60, base - h - 26);
    ctx.globalAlpha = 1;
    ctx.fillStyle = MUTED;
    ctx.font = `500 26px ${BODY}`;
    ctx.fillText(label, x + 60, base + 40);
  });
  ctx.textAlign = 'left';
}

function steps(ctx: CanvasRenderingContext2D, t: number): void {
  const items = ['Design', 'Build', 'Play-test', 'Launch'];
  const active = Math.floor(t / 1.4) % items.length;
  items.forEach((s, i) => {
    const x = 110 + i * 275;
    const on = i === active;
    const done = i < active;
    ctx.fillStyle = on ? BRAND : done ? '#E3F7F2' : '#F3F4F8';
    ctx.beginPath();
    ctx.roundRect(x, 270, 240, 230, 30);
    ctx.fill();
    ctx.fillStyle = on ? '#FFFFFF' : done ? BRAND : MUTED;
    ctx.font = `700 60px ${DISPLAY}`;
    ctx.fillText(done ? '✓' : String(i + 1), x + 34, 360);
    ctx.font = `600 40px ${BODY}`;
    ctx.fillStyle = on ? '#FFFFFF' : INK;
    ctx.fillText(s, x + 34, 450);
    if (i < items.length - 1) {
      ctx.fillStyle = '#D5D8E3';
      ctx.beginPath();
      ctx.arc(x + 257, 385, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

const SLIDES: readonly Slide[] = [
  { title: 'Q3 Roadmap', kicker: 'All-hands · Boardroom 12F', draw: bullets },
  { title: 'Team Pulse', kicker: 'Survey results, very scientific', draw: chart },
  { title: 'Next Steps', kicker: 'Where we are right now', draw: steps },
];

export class DemoPresentation {
  readonly canvas: HTMLCanvasElement;
  readonly stream: MediaStream | null;
  private readonly ctx: CanvasRenderingContext2D;
  private time = 0;
  private acc = 0;

  constructor(doc: Document) {
    this.canvas = doc.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.draw();
    this.stream =
      typeof this.canvas.captureStream === 'function' ? this.canvas.captureStream(30) : null;
  }

  /** Advance the animation; draws at ~30 fps regardless of display rate. */
  update(dt: number): void {
    this.time += dt;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    this.draw();
  }

  dispose(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
  }

  private draw(): void {
    const { ctx } = this;
    const index = Math.floor(this.time / SLIDE_SECONDS) % SLIDES.length;
    const local = this.time % SLIDE_SECONDS;
    const slide = SLIDES[index] as Slide;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    // Header: a soft aqua band with the title.
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#E8FAF6');
    g.addColorStop(1, '#EEF3FF');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 150);
    ctx.fillStyle = BRAND;
    ctx.font = `600 24px ${BODY}`;
    ctx.fillText(slide.kicker.toUpperCase(), 110, 52);
    ctx.fillStyle = INK;
    ctx.font = `700 50px ${DISPLAY}`;
    ctx.fillText(slide.title, 106, 104);
    // Brand mark and page dots.
    ctx.fillStyle = MUTED;
    ctx.font = `500 22px ${BODY}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${index + 1} / ${SLIDES.length}`, W - 80, 52);
    ctx.textAlign = 'left';
    drawBrandMark(ctx, W - 146, 70, 66);
    slide.draw(ctx, local);
    // Footer: progress through this slide.
    ctx.fillStyle = '#EEF0F5';
    ctx.fillRect(0, H - 10, W, 10);
    ctx.fillStyle = BRAND;
    ctx.fillRect(0, H - 10, (local / SLIDE_SECONDS) * W, 10);
    const wordW = drawWordmark(ctx, 110, H - 37, 15, { squid: INK, meet: BRAND });
    ctx.fillStyle = MUTED;
    ctx.font = `500 20px ${BODY}`;
    ctx.fillText('· made with zero real tomatoes', 110 + wordW + 10, H - 44);
  }
}
