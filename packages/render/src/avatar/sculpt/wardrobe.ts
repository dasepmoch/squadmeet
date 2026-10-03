import type { AvatarSpec } from '@huddle/shared';
import { arm, box, cone, ell, half, rootFade, torso, torus, type Side } from './body.ts';
import type { Figure } from './figure.ts';
import { dot3, group, invRotation, lerp3, norm3, scale3, sub3, Sculpt, type V3 } from './sdf.ts';

export const TAG = {
  main: 0,
  rib: 1,
  trim: 2,
  pocket: 3,
  shirt: 4,
  belt: 5,
  sole: 6,
  hood: 7,
  scarf: 8,
} as const;

interface TopStyle {
  t: number;
  ease: number;
  long: boolean;
  hemDrop: number;
  collar: 'crew' | 'hood' | 'rib' | 'v' | 'polo' | 'turtle';
  cuffs: boolean;
  /** Worn tucked into belted trousers (the belt shows). */
  tucked?: boolean;
}

const TOPS: readonly TopStyle[] = [
  { t: 0.006, ease: 0.003, long: false, hemDrop: 0.03, collar: 'crew', cuffs: false },
  { t: 0.011, ease: 0.007, long: true, hemDrop: 0.045, collar: 'hood', cuffs: true },
  { t: 0.01, ease: 0.004, long: true, hemDrop: 0.035, collar: 'rib', cuffs: true },
  { t: 0.013, ease: 0.006, long: true, hemDrop: 0.12, collar: 'v', cuffs: false },
  {
    t: 0.007,
    ease: 0.003,
    long: false,
    hemDrop: 0.035,
    collar: 'polo',
    cuffs: false,
    tucked: true,
  },
  { t: 0.009, ease: 0.003, long: true, hemDrop: 0.04, collar: 'turtle', cuffs: true },
];

export interface TopResult {
  top: Sculpt;
  /** Dress shirt under a blazer. */
  shirt: Sculpt | null;
  hemY: number;
  /** Hem of the innermost layer (the shirt under a blazer): trousers tuck under this one. */
  innerHemY: number;
  long: boolean;
  style: TopStyle['collar'];
  /** Garment thickness when tucked into the trousers, else null. */
  tuckedT: number | null;
}

function sleeve(
  f: Figure,
  side: Side,
  t: number,
  long: boolean,
  cuffs: boolean,
  tag: number,
  extraCut = 0,
): Sculpt {
  const j = f.joints;
  const L = side === 'L';
  const up = L ? j.upperArmL : j.upperArmR;
  const elbow = L ? j.lowerArmL : j.lowerArmR;
  const wrist = L ? j.handL : j.handR;
  const s = new Sculpt();
  arm(f, side, { t, ease: 0, tag }, s, long ? 'wrist' : 'elbow');
  if (long) {
    const dir = norm3(sub3(wrist, elbow));
    const end = sub3(wrist, scale3(dir, 0.012 * f.s + extraCut));
    if (cuffs) {
      s.add(
        cone(
          sub3(end, scale3(dir, 0.055 * f.s)),
          end,
          0.03 * f.s + t + 0.003,
          0.028 * f.s + t + 0.003,
        ),
        0.006 * f.s,
        L ? 'lowerArmL' : 'lowerArmR',
        TAG.rib,
      );
    }
    s.clip(half(dir, dot3(dir, end)), 0.003 * f.s);
  } else {
    const dir = norm3(sub3(elbow, up));
    const cut = lerp3(up, elbow, 0.48);
    s.clip(half(dir, dot3(dir, cut)), 0.003 * f.s);
  }
  return s;
}

function torsoLayer(
  f: Figure,
  t: number,
  ease: number,
  tag: number,
  y0: number,
  y1: number,
): Sculpt {
  const s = new Sculpt();
  torso(f, { t, ease, tag }, s);
  s.clip(half([0, -1, 0], -y0), 0.004 * f.s);
  s.clip(half([0, 1, 0], y1), 0.004 * f.s);
  return s;
}

/**
 * Front-only wedge {|x| < slope * (y - apexY) * dir}: dir 1 opens upwards from the apex (a V
 * neckline), -1 opens downwards (a cutaway front).
 */
function frontWedge(s: number, apexY: number, slope: number, dir: 1 | -1): Sculpt {
  const n1 = norm3([1, -slope * dir, 0]);
  const n2 = norm3([-1, -slope * dir, 0]);
  const apex: V3 = [0, apexY, 0];
  const w = new Sculpt();
  w.add(box([0, apexY + dir * 0.3 * s, 0.12 * s], [0.25 * s, 0.32 * s, 0.12 * s], 0), 0, 'chest');
  w.clip(half(n1, dot3(n1, apex)), 0.004 * s);
  w.clip(half(n2, dot3(n2, apex)), 0.004 * s);
  w.clip(half([0, 0, -1], -0.01 * s), 0.004 * s);
  return w;
}

/** Tops: tee, hoodie, sweater, blazer (over a dress shirt), polo, turtleneck. */
export function topSculpt(f: Figure, spec: AvatarSpec): TopResult {
  const cfg: TopStyle = TOPS[spec.topStyle] ?? (TOPS[0] as TopStyle);
  const s = f.s;
  const neck = f.joints.neck;
  const hemY = f.hipY - cfg.hemDrop * s;
  const sc = new Sculpt();
  const shoulderFade = rootFade(f.shoulderY, 0.13 * s, -0.02 * s);
  sc.add(group(torsoLayer(f, cfg.t, cfg.ease, TAG.main, hemY, 2)), 0, '*');
  if (cfg.cuffs)
    sc.add(
      group(torsoLayer(f, cfg.t + 0.004, cfg.ease, TAG.rib, hemY, hemY + 0.055 * s)),
      0.004 * s,
      '*',
    );
  for (const side of ['L', 'R'] as const) {
    const cut = cfg.collar === 'v' ? 0.03 * s : 0;
    sc.add(
      group(sleeve(f, side, cfg.t, cfg.long, cfg.cuffs, TAG.main, cut)),
      0.03 * s,
      '*',
      0,
      shoulderFade,
    );
  }
  const front = (y: number): number => 0.094 * s + cfg.t + cfg.ease + (y > f.waistY ? 0.01 * s : 0);
  switch (cfg.collar) {
    case 'crew':
    case 'rib': {
      sc.sub(
        cone(
          [0, neck[1] - 0.085 * s, neck[2] + 0.03 * s],
          [0, neck[1] + 0.2 * s, neck[2] - 0.04 * s],
          0.062 * s,
          0.062 * s,
        ),
        0.008 * s,
      );
      const r = cfg.collar === 'rib' ? 0.011 : 0.0065;
      sc.add(
        torus(
          [0, neck[1] - 0.018 * s, neck[2] + 0.004 * s],
          0.063 * s + r * s * 0.3,
          r * s,
          invRotation(0.32, 0, 0),
        ),
        0.006 * s,
        'chest',
        TAG.rib,
      );
      break;
    }
    case 'hood': {
      sc.sub(
        cone(
          [0, neck[1] - 0.08 * s, neck[2] + 0.03 * s],
          [0, neck[1] + 0.2 * s, neck[2] - 0.04 * s],
          0.07 * s,
          0.07 * s,
        ),
        0.01 * s,
      );
      // A folded-down hood lying on the upper back (kept low so it never swallows the neck).
      const hood = new Sculpt();
      hood.add(
        ell([0, neck[1] - 0.012 * s, neck[2] - 0.07 * s], [0.108 * s, 0.072 * s, 0.074 * s]),
        0,
        'chest',
        TAG.hood,
      );
      hood.sub(
        ell([0, neck[1] + 0.024 * s, neck[2] - 0.045 * s], [0.08 * s, 0.066 * s, 0.056 * s]),
        0.01 * s,
      );
      hood.clip(half([0, 0, 1], neck[2] + 0.015 * s), 0.02 * s);
      sc.add(group(hood), 0.02 * s, '*');
      sc.add(
        torus(
          [0, neck[1] - 0.015 * s, neck[2] + 0.008 * s],
          0.074 * s,
          0.012 * s,
          invRotation(0.3, 0, 0),
        ),
        0.01 * s,
        'chest',
        TAG.hood,
      );
      const py = f.hipY + 0.075 * s;
      sc.add(
        box([0, py, front(py) - 0.006 * s], [0.105 * s, 0.062 * s, 0.012 * s], 0.012 * s),
        0.006 * s,
        'spine',
        TAG.pocket,
      );
      break;
    }
    case 'v': {
      const y0 = f.waistY + 0.035 * s;
      const top = neck[1] - 0.01 * s;
      // Open V above the button, and fronts that curve apart below it (a closed hem reads as a
      // leotard), showing the shirt underneath.
      sc.sub(group(frontWedge(s, y0, (0.078 * s) / (top - y0), 1)), 0.004 * s);
      sc.sub(group(frontWedge(s, y0 - 0.012 * s, (0.075 * s) / (y0 - hemY), -1)), 0.004 * s);
      sc.sub(
        cone(
          [0, neck[1] - 0.06 * s, neck[2]],
          [0, neck[1] + 0.2 * s, neck[2] - 0.03 * s],
          0.066 * s,
          0.066 * s,
        ),
        0.008 * s,
      );
      // Lapels along the V edges and a collar behind the neck.
      for (const side of [1, -1]) {
        const mid: V3 = [
          side * 0.052 * s,
          (y0 + top) / 2 + 0.02 * s,
          front((y0 + top) / 2) + 0.004 * s,
        ];
        sc.add(
          box(
            mid,
            [0.022 * s, 0.1 * s, 0.004 * s],
            0.003 * s,
            invRotation(-0.12, side * 0.28, side * 0.34),
          ),
          0.004 * s,
          'chest',
          TAG.trim,
        );
      }
      sc.add(
        torus(
          [0, neck[1] - 0.01 * s, neck[2] - 0.004 * s],
          0.068 * s,
          0.01 * s,
          invRotation(0.5, 0, 0),
        ),
        0.006 * s,
        'chest',
        TAG.trim,
      );
      for (const side of [1, -1])
        sc.add(
          box(
            [side * 0.1 * s, f.hipY + 0.02 * s, front(f.hipY) - 0.006 * s],
            [0.045 * s, 0.006 * s, 0.01 * s],
            0.003 * s,
          ),
          0.004 * s,
          'hips',
          TAG.trim,
        );
      break;
    }
    case 'polo': {
      sc.sub(
        cone(
          [0, neck[1] - 0.07 * s, neck[2] + 0.02 * s],
          [0, neck[1] + 0.2 * s, neck[2] - 0.03 * s],
          0.058 * s,
          0.058 * s,
        ),
        0.008 * s,
      );
      sc.add(
        torus([0, neck[1] - 0.005 * s, neck[2]], 0.06 * s, 0.013 * s, invRotation(0.36, 0, 0)),
        0.008 * s,
        'chest',
        TAG.trim,
      );
      const py = neck[1] - 0.075 * s;
      sc.add(
        box([0, py, front(py) + 0.0 * s], [0.015 * s, 0.042 * s, 0.005 * s], 0.003 * s),
        0.004 * s,
        'chest',
        TAG.trim,
      );
      break;
    }
    case 'turtle':
      sc.add(
        cone(
          [0, neck[1] - 0.03 * s, neck[2]],
          [0, neck[1] + 0.078 * s, neck[2] + 0.004 * s],
          0.063 * s,
          0.056 * s,
        ),
        0.02 * s,
        'neck',
        TAG.rib,
      );
      sc.add(
        torus([0, neck[1] + 0.062 * s, neck[2] + 0.004 * s], 0.058 * s, 0.014 * s),
        0.006 * s,
        'neck',
        TAG.rib,
      );
      break;
  }
  const shirt = cfg.collar === 'v' ? shirtSculpt(f) : null;
  return {
    top: sc,
    shirt,
    hemY,
    innerHemY: shirt ? SHIRT_HEM(f) : hemY,
    long: cfg.long,
    style: cfg.collar,
    tuckedT: cfg.tucked ? cfg.t + cfg.ease : null,
  };
}

const SHIRT_HEM = (f: Figure): number => f.hipY - 0.05 * f.s;

/** Dress shirt worn under the blazer: slim fit, long sleeves with cuffs, a rolled collar band. */
function shirtSculpt(f: Figure): Sculpt {
  const s = f.s;
  const neck = f.joints.neck;
  const sc = new Sculpt();
  sc.add(group(torsoLayer(f, 0.005, 0.002, TAG.shirt, SHIRT_HEM(f), 2)), 0, '*');
  const fade = rootFade(f.shoulderY, 0.13 * s, -0.02 * s);
  for (const side of ['L', 'R'] as const)
    sc.add(
      group(sleeve(f, side, 0.005, true, true, TAG.shirt, -0.004 * s)),
      0.03 * s,
      '*',
      0,
      fade,
    );
  // The opening is wider than the torso's neck cone so no paper-thin sliver survives, and the
  // collar is a round band thick enough to mesh cleanly.
  sc.sub(
    cone(
      [0, neck[1] - 0.05 * s, neck[2] + 0.01 * s],
      [0, neck[1] + 0.2 * s, neck[2] - 0.02 * s],
      0.061 * s,
      0.061 * s,
    ),
    0.006 * s,
  );
  sc.add(
    torus(
      [0, neck[1] - 0.004 * s, neck[2] + 0.004 * s],
      0.058 * s,
      0.0105 * s,
      invRotation(0.36, 0, 0),
    ),
    0.006 * s,
    'neck',
    TAG.shirt,
  );
  return sc;
}

/** Knitted scarf: a loop around the neck with two ends hanging down the chest. */
export function scarfSculpt(f: Figure): Sculpt {
  const s = f.s;
  const neck = f.joints.neck;
  const sc = new Sculpt();
  sc.add(
    torus(
      [0, neck[1] - 0.005 * s, neck[2] + 0.004 * s],
      0.074 * s,
      0.026 * s,
      invRotation(0.25, 0, 0),
    ),
    0,
    'chest',
    TAG.scarf,
  );
  sc.add(
    box(
      [0.035 * s, neck[1] - 0.14 * s, 0.125 * s],
      [0.03 * s, 0.11 * s, 0.012 * s],
      0.01 * s,
      invRotation(-0.18, 0, 0.06),
    ),
    0.02 * s,
    'chest',
    TAG.scarf,
  );
  sc.add(
    box(
      [-0.012 * s, neck[1] - 0.11 * s, 0.13 * s],
      [0.028 * s, 0.085 * s, 0.012 * s],
      0.01 * s,
      invRotation(-0.2, 0, -0.08),
    ),
    0.02 * s,
    'chest',
    TAG.scarf,
  );
  return sc;
}
