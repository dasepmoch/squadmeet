import { BRAND_COLORS, MARK, WORDMARK } from '@huddle/shared';

/** Canvas paths are parsed once per page. */
let paths: {
  mantle: Path2D;
  fins: Path2D;
  arms: Path2D;
  glyphs: Path2D[];
  drop: Path2D;
} | null = null;

function brandPaths(): NonNullable<typeof paths> {
  if (paths) return paths;
  const arms = new Path2D();
  for (const d of MARK.arms) arms.addPath(new Path2D(d));
  paths = {
    mantle: new Path2D(MARK.mantle),
    fins: new Path2D(MARK.fins),
    arms,
    glyphs: WORDMARK.glyphs.map((d) => new Path2D(d)),
    drop: new Path2D(WORDMARK.drop),
  };
  return paths;
}

/** The squid mark, `size` px square, top-left at (x, y): the HUD logo, in flat brand colors. */
export function drawBrandMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const p = brandPaths();
  const s = size / MARK.size;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = BRAND_COLORS.deep;
  ctx.lineWidth = MARK.armWidth;
  ctx.lineCap = 'round';
  ctx.stroke(p.arms);
  const body = ctx.createLinearGradient(0, 3, 0, 47);
  body.addColorStop(0, BRAND_COLORS.light);
  body.addColorStop(0.45, BRAND_COLORS.aqua);
  body.addColorStop(1, '#14B193');
  ctx.fillStyle = body;
  ctx.fill(p.mantle);
  ctx.fill(p.fins);
  ctx.fillStyle = BRAND_COLORS.ink;
  for (const e of MARK.eyes) {
    ctx.beginPath();
    ctx.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#FFFFFF';
  for (const g of MARK.glints) {
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The lettering with its baseline at `baseline`, starting at `x`; `capHeight` px tall capitals.
 * Returns the drawn width.
 */
export function drawWordmark(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  capHeight: number,
  colors: { squid: string; meet: string },
): number {
  const p = brandPaths();
  // Unbounded's capitals are 75 units tall.
  const s = capHeight / 75;
  ctx.save();
  ctx.translate(x, baseline);
  ctx.scale(s, s);
  p.glyphs.forEach((g, i) => {
    ctx.fillStyle = i < WORDMARK.squidGlyphs ? colors.squid : colors.meet;
    ctx.fill(g);
  });
  ctx.fillStyle = colors.meet;
  ctx.fill(p.drop);
  ctx.restore();
  return WORDMARK.width * s;
}
