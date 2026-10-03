import type { AvatarSpec } from '@huddle/shared';
import { arm, box, cone, ell, foot, half, leg, rootFade, torso, torus } from './body.ts';
import type { Figure } from './figure.ts';
import { add3, dot3, group, lerp3, norm3, scale3, Sculpt, sub3 } from './sdf.ts';
import { TAG, type TopResult } from './wardrobe.ts';

/** Bottoms, shoes and the bare skin they (and short sleeves) leave showing. */
export interface BottomResult {
  bottom: Sculpt;
  /** How much leg shows below the garment. */
  exposed: 'none' | 'knee' | 'thigh';
  /** Height of the visible belt's center, or null (no belt, or hidden under the top). */
  beltY: number | null;
}

/**
 * Bottoms: jeans, chinos, skirt, shorts, joggers. The waist hides under an untucked top's hem;
 * tucked tops go inside the waistband and show the belt.
 */
export function bottomSculpt(
  f: Figure,
  spec: AvatarSpec,
  top: Pick<TopResult, 'innerHemY' | 'tuckedT'>,
): BottomResult {
  const s = f.s;
  const style = spec.bottomStyle;
  const t = [0.007, 0.01, 0.006, 0.01, 0.013][style] ?? 0.008;
  const belted = style === 0 || style === 1;
  const tucked = top.tuckedT !== null && style !== 2;
  // Tucked: the waistband sits outside the top; untucked: it hides under the innermost hem.
  const waistTop = tucked ? f.waistY - 0.004 * s : Math.min(top.innerHemY + 0.02 * s, f.waistY);
  const band = tucked ? (top.tuckedT ?? 0) + 0.004 : 0.004;
  const sc = new Sculpt();
  const pelvis = new Sculpt();
  torso(f, { t: band, ease: 0.002, tag: TAG.main }, pelvis);
  pelvis.clip(half([0, 1, 0], waistTop), 0.004 * s);
  sc.add(group(pelvis), 0, '*');
  let beltY: number | null = null;
  if (belted && tucked) {
    const belt = new Sculpt();
    torso(f, { t: band + 0.003, ease: 0.002, tag: TAG.belt }, belt);
    belt.clip(half([0, 1, 0], waistTop - 0.004 * s), 0.002 * s);
    belt.clip(half([0, -1, 0], -(waistTop - 0.034 * s)), 0.002 * s);
    sc.add(group(belt), 0.003 * s, '*');
    beltY = waistTop - 0.019 * s;
  }
  const hipFade = rootFade(f.hipJointY, 0.11 * s, 0.02 * s);
  if (style === 2) {
    const hem = f.kneeY + 0.06 * s;
    const skirt = new Sculpt();
    skirt.add(
      ell(
        [0, (waistTop + hem) / 2 - 0.02 * s, -0.004 * s],
        [0.2 * s * f.hip, (waistTop - hem) / 2 + 0.09 * s, 0.158 * s * f.hip],
      ),
      0,
      'hips',
      TAG.main,
    );
    skirt.clip(half([0, -1, 0], -hem), 0.004 * s);
    skirt.clip(half([0, 1, 0], waistTop), 0.004 * s);
    sc.add(group(skirt), 0.04 * s, '*');
    return { bottom: sc, exposed: 'knee', beltY };
  }
  for (const side of ['L', 'R'] as const) {
    const l = new Sculpt();
    leg(f, side, { t, ease: 0, tag: TAG.main }, l, style === 3 ? 'knee' : 'ankle');
    const hem = style === 3 ? f.kneeY + 0.13 * s : f.ankleY + (style === 4 ? 0.02 : 0.035) * s;
    if (style === 4) {
      const ankle = side === 'L' ? f.joints.footL : f.joints.footR;
      l.add(
        cone(
          add3(ankle, [0, 0.02 * s, 0]),
          add3(ankle, [0, 0.07 * s, 0]),
          0.04 * s + t,
          0.042 * s + t,
        ),
        0.006 * s,
        side === 'L' ? 'shinL' : 'shinR',
        TAG.rib,
      );
    }
    l.clip(half([0, -1, 0], -hem), 0.003 * s);
    sc.add(group(l), 0.05 * s, '*', 0, hipFade);
  }
  return { bottom: sc, exposed: style === 3 ? 'thigh' : 'none', beltY };
}

/** Shoes: sneakers, boots, loafers, high-tops. Upper hugs the foot; the sole is a separate slab. */
export function shoeSculpt(f: Figure, spec: AvatarSpec): Sculpt {
  const s = f.s;
  const style = spec.shoeStyle;
  const sc = new Sculpt();
  const soleH = [0.02, 0.022, 0.01, 0.022][style] ?? 0.02;
  for (const side of ['L', 'R'] as const) {
    const ankle = side === 'L' ? f.joints.footL : f.joints.footR;
    const toe = side === 'L' ? f.tips.toeL : f.tips.toeR;
    const bone = side === 'L' ? 'footL' : 'footR';
    const zc = (ankle[2] + toe[2]) / 2 - 0.004 * s;
    const upper = new Sculpt();
    foot(f, side, style === 2 ? 0.006 * s : 0.011 * s, TAG.main, upper);
    if (style === 1 || style === 3) {
      const top = style === 1 ? 0.2 : 0.14;
      upper.add(
        cone(
          add3(ankle, [0, -0.02 * s, -0.005 * s]),
          [ankle[0], top * s, ankle[2] - 0.008 * s],
          0.052 * s,
          0.046 * s,
        ),
        0.03 * s,
        bone,
        TAG.main,
      );
      upper.add(
        torus([ankle[0], top * s - 0.006 * s, ankle[2] - 0.008 * s], 0.043 * s, 0.009 * s),
        0.004 * s,
        bone,
        TAG.trim,
      );
    }
    if (style === 2) upper.clip(half([0, 1, 0], 0.075 * s), 0.004 * s);
    if (style === 0 || style === 3)
      upper.add(
        ell([ankle[0], 0.036 * s, toe[2] - 0.028 * s], [0.05 * s, 0.028 * s, 0.045 * s]),
        0.01 * s,
        bone,
        TAG.trim,
      );
    upper.clip(half([0, -1, 0], -(soleH * s - 0.003 * s)), 0.003 * s);
    sc.add(group(upper), 0, '*');
    sc.add(
      box(
        [ankle[0], (soleH * s) / 2, zc],
        [0.052 * s, (soleH * s) / 2, 0.136 * s],
        Math.min(0.012, soleH * 0.45) * s,
      ),
      0.004 * s,
      bone,
      TAG.sole,
    );
  }
  return sc;
}

export function limbSkin(f: Figure, top: TopResult, bottom: BottomResult): Sculpt | null {
  const s = f.s;
  const sc = new Sculpt();
  let any = false;
  if (!top.long) {
    for (const side of ['L', 'R'] as const) {
      const g = new Sculpt();
      arm(f, side, { t: 0, ease: 0, tag: 0 }, g, 'wrist');
      const up = side === 'L' ? f.joints.upperArmL : f.joints.upperArmR;
      const elbow = side === 'L' ? f.joints.lowerArmL : f.joints.lowerArmR;
      const dir = norm3(sub3(elbow, up));
      const cut = lerp3(up, elbow, 0.3);
      g.clip(half(scale3(dir, -1), -dot3(dir, cut)), 0.003 * s);
      sc.add(group(g), 0, '*');
      any = true;
    }
  }
  if (bottom.exposed !== 'none') {
    for (const side of ['L', 'R'] as const) {
      const g = new Sculpt();
      leg(f, side, { t: 0, ease: 0, tag: 0 }, g, 'ankle');
      const top2 = bottom.exposed === 'knee' ? f.kneeY + 0.1 * s : f.kneeY + 0.2 * s;
      g.clip(half([0, 1, 0], top2), 0.003 * s);
      g.clip(half([0, -1, 0], -(f.ankleY + 0.01 * s)), 0.003 * s);
      sc.add(group(g), 0, '*');
      any = true;
    }
  }
  return any ? sc : null;
}
