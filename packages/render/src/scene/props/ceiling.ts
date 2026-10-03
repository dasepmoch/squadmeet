import type { PropInstance } from '@huddle/shared';
import type { PartList } from '../../geometry/parts.ts';
import { ringSlabGeometry } from '../../geometry/shapes.ts';
import { paramNumber, type BuildContext } from '../build-context.ts';

/** Fixture brightness (emissive) of the room's default white. */
const FIXTURE_GLOW = 2.6;

/** Suspended rounded-rectangle ring luminaire over the table, direct/indirect. */
export function buildCeilingRing(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 1.3);
  const d = paramNumber(inst, 'depth', 5.8);
  const drop = paramNumber(inst, 'drop', 0.8);
  const body = ctx.color(inst.color, 'graphite');
  const light = ctx.room.data.lighting.fixtureColor;
  const corner = Math.min(w, d) * 0.3;
  p.castShadow = false;
  p.add(ringSlabGeometry(w, d, 0.075, 0.06, corner), 'powder', body, [0, -drop, 0]);
  p.add(
    ringSlabGeometry(w - 0.012, d - 0.012, 0.06, 0.006, corner - 0.006),
    'fixture',
    ctx.emissive(light, 'neutralWhite', FIXTURE_GLOW * 1.1),
    [0, -drop - 0.032, 0],
  );
  p.add(
    ringSlabGeometry(w - 0.02, d - 0.02, 0.05, 0.004, corner - 0.01),
    'fixture',
    ctx.emissive(light, 'neutralWhite', 1.1),
    [0, -drop + 0.031, 0],
  );
  const chrome = ctx.color('chrome', 'chrome');
  const white = ctx.color('offWhite', 'offWhite');
  for (const [x, z] of [
    [-w / 2 + 0.04, -d / 2 + 0.6],
    [w / 2 - 0.04, -d / 2 + 0.6],
    [-w / 2 + 0.04, d / 2 - 0.6],
    [w / 2 - 0.04, d / 2 - 0.6],
  ] as const) {
    p.cylinder(
      0.0016,
      0.0016,
      drop - 0.03,
      'chrome',
      chrome,
      [x, -drop / 2 + 0.01, z],
      [0, 0, 0],
      6,
    );
    p.cylinder(0.035, 0.035, 0.014, 'powder', white, [x, -0.007, z], [0, 0, 0], 20);
  }
  p.castShadow = true;
}

/** Recessed 1200 x 600 LED panel, flush with the ceiling. */
export function buildCeilingPanel(_inst: PropInstance, ctx: BuildContext, p: PartList): void {
  p.castShadow = false;
  p.add(
    ringSlabGeometry(1.2, 0.6, 0.022, 0.01, 0.004),
    'powder',
    ctx.color('white', 'white'),
    [0, -0.005, 0],
  );
  p.plane(
    1.16,
    0.56,
    'fixture',
    ctx.emissive(ctx.room.data.lighting.fixtureColor, 'neutralWhite', FIXTURE_GLOW * 0.85),
    [0, -0.003, 0],
    [Math.PI / 2, 0, 0],
  );
  p.castShadow = true;
}

/** Flush round downlight (wall-washer) with a white trim ring. */
export function buildDownlight(_inst: PropInstance, ctx: BuildContext, p: PartList): void {
  p.castShadow = false;
  p.torus(0.066, 0.008, 'powder', ctx.color('white', 'white'), [0, -0.004, 0], [Math.PI / 2, 0, 0]);
  p.cylinder(
    0.058,
    0.058,
    0.002,
    'fixture',
    ctx.emissive(ctx.room.data.lighting.fixtureColor, 'neutralWhite', FIXTURE_GLOW * 1.3),
    [0, -0.002, 0],
    [0, 0, 0],
    32,
  );
  p.castShadow = true;
}

/** Three dome pendants on cords at staggered heights. */
export function buildPendantCluster(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const drop = paramNumber(inst, 'drop', 0.9);
  const shade = ctx.color(inst.color, 'black');
  const white = ctx.color('offWhite', 'offWhite');
  p.castShadow = false;
  p.box([0.62, 0.02, 0.09], 'powder', shade, [0, -0.01, 0], 0.006);
  for (const [x, z, k] of [
    [-0.24, 0.02, 0.92],
    [0.02, -0.03, 1.08],
    [0.25, 0.03, 0.8],
  ] as const) {
    const len = drop * k;
    p.cylinder(0.003, 0.003, len, 'rubber', shade, [x, -len / 2, z], [0, 0, 0], 6);
    p.latheShell(
      'pendant-dome',
      [
        [0.16, 0],
        [0.155, 0.03],
        [0.12, 0.12],
        [0.06, 0.19],
        [0.016, 0.22],
      ],
      0.004,
      'powder',
      shade,
      [x, -len - 0.22, z],
      white,
    );
    p.sphere(
      0.04,
      'lamp',
      ctx.emissive('warmWhite', 'warmWhite', 3.2),
      [x, -len - 0.2, z],
      [1, 1, 1],
      16,
    );
  }
  p.castShadow = true;
}

/** Small ceiling services: supply diffuser, speaker grille, sprinkler, smoke detector. */
export function buildCeilingDetail(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const white = ctx.color('white', 'white');
  p.castShadow = false;
  switch (inst.variant) {
    case 'vent':
      p.add(ringSlabGeometry(0.6, 0.6, 0.05, 0.016, 0.004), 'powder', white, [0, -0.008, 0]);
      for (const s of [0.46, 0.34, 0.22])
        p.add(ringSlabGeometry(s, s, 0.014, 0.012, 0.002), 'powder', white, [0, -0.012, 0]);
      p.plane(
        0.5,
        0.5,
        'paint',
        ctx.color('#5A5C60', '#5A5C60'),
        [0, -0.001, 0],
        [Math.PI / 2, 0, 0],
      );
      break;
    case 'speaker':
      p.cylinder(
        0.1,
        0.1,
        0.006,
        'powder',
        ctx.color('offWhite', 'offWhite'),
        [0, -0.003, 0],
        [0, 0, 0],
        40,
      );
      p.torus(0.1, 0.005, 'powder', white, [0, -0.004, 0], [Math.PI / 2, 0, 0]);
      break;
    case 'sprinkler':
      p.cylinder(
        0.03,
        0.03,
        0.004,
        'chrome',
        ctx.color('chrome', 'chrome'),
        [0, -0.002, 0],
        [0, 0, 0],
        20,
      );
      p.cylinder(
        0.006,
        0.008,
        0.03,
        'chrome',
        ctx.color('brass', 'brass'),
        [0, -0.018, 0],
        [0, 0, 0],
        10,
      );
      p.cylinder(
        0.018,
        0.018,
        0.002,
        'chrome',
        ctx.color('brass', 'brass'),
        [0, -0.034, 0],
        [0, 0, 0],
        16,
      );
      break;
    default:
      p.cylinder(0.06, 0.065, 0.035, 'plastic', white, [0, -0.0175, 0], [0, 0, 0], 32);
      p.sphere(
        0.003,
        'emissive',
        ctx.emissive('#FF3B30', '#FF3B30', 3),
        [0.03, -0.036, 0],
        [1, 1, 1],
        8,
      );
      break;
  }
  p.castShadow = true;
}
