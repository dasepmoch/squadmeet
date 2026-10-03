import type { AvatarSpec } from '@huddle/shared';
import { box, cone, ell, half, sph, torus } from './body.ts';
import type { HeadSpace } from './head.ts';
import { invRotation, Sculpt, type Shape } from './sdf.ts';

/** Paint tags shared by the hair, facial hair and headwear sculpts. */
export const TAG_HAIR = 0;
export const TAG_HAT = 1;
export const TAG_HAT_BAND = 2;
export const TAG_HAT_BRIM = 3;

/** Moustache, goatee and beard volumes added to the hair sculpt. */
export function addFacialHair(spec: AvatarSpec, hs: HeadSpace, sc: Sculpt): void {
  const add = (s: Shape, k: number): void => {
    sc.add(hs.shape(s), hs.r(k), 'head', TAG_HAIR);
  };
  if (spec.facialHair === 2 || spec.facialHair === 4) {
    add(ell([0, 0.063, 0.106], [0.023, 0.007, 0.01]), 0.006);
  }
  if (spec.facialHair === 3) {
    add(ell([0, 0.026, 0.078], [0.02, 0.018, 0.02]), 0.01);
    add(ell([0, 0.063, 0.106], [0.02, 0.0065, 0.0095]), 0.006);
  }
  if (spec.facialHair === 4) {
    const beard = new Sculpt();
    beard.add(hs.shape(ell([0, 0.064, 0.03], [0.09, 0.075, 0.085])), 0, 'head', TAG_HAIR);
    beard.add(hs.shape(ell([0, 0.03, 0.06], [0.05, 0.04, 0.047])), hs.r(0.03), 'head', TAG_HAIR);
    beard.clip(hs.shape(half([0, 1, 0], 0.078)), hs.r(0.015));
    beard.clip(hs.shape(half([0, 0, -1], 0.02)), hs.r(0.02));
    beard.sub(hs.shape(ell([0, 0.049, 0.11], [0.019, 0.012, 0.02])), hs.r(0.006));
    sc.add({ t: 'group', s: beard }, hs.r(0.01), 'head', TAG_HAIR);
  }
}

/** Beanie, cap, headband and bucket hat (headphones are rigid parts, built elsewhere). */
export function headwearSculpt(spec: AvatarSpec, hs: HeadSpace): Sculpt | null {
  const kind = spec.headwear;
  if (kind === 0 || kind === 4) return null;
  const sc = new Sculpt();
  const add = (s: Shape, k: number, tag: number): void => {
    sc.add(hs.shape(s), hs.r(k), 'head', tag);
  };
  if (kind === 1) {
    add(ell([0, 0.15, -0.012], [0.112, 0.128, 0.124]), 0, TAG_HAT);
    sc.clip(hs.shape(half([0, -1, 0], -0.118)), hs.r(0.006));
    add(ell([0, 0.132, -0.01], [0.118, 0.03, 0.13]), 0.006, TAG_HAT_BAND);
    sc.clip(hs.shape(half([0, -1, 0], -0.108)), hs.r(0.004));
  } else if (kind === 2) {
    add(ell([0, 0.158, -0.008], [0.108, 0.1, 0.118]), 0, TAG_HAT);
    sc.clip(hs.shape(half([0, -1, 0], -0.15)), hs.r(0.005));
    add(
      box([0, 0.152, 0.13], [0.078, 0.006, 0.06], 0.005, invRotation(0.18, 0, 0)),
      0.01,
      TAG_HAT_BRIM,
    );
    add(sph([0, 0.262, -0.01], 0.008), 0.004, TAG_HAT_BAND);
  } else if (kind === 3) {
    add(torus([0, 0.176, -0.008], 0.104, 0.011, invRotation(-0.28, 0, 0)), 0, TAG_HAT);
  } else {
    add(ell([0, 0.17, -0.008], [0.11, 0.1, 0.118]), 0, TAG_HAT);
    sc.clip(hs.shape(half([0, -1, 0], -0.145)), hs.r(0.006));
    const brim = new Sculpt();
    brim.add(
      hs.shape(cone([0, 0.16, -0.008], [0, 0.12, -0.008], 0.13, 0.17)),
      0,
      'head',
      TAG_HAT_BRIM,
    );
    brim.sub(hs.shape(cone([0, 0.175, -0.008], [0, 0.11, -0.008], 0.108, 0.155)), hs.r(0.004));
    sc.add({ t: 'group', s: brim }, hs.r(0.006), '*', TAG_HAT_BRIM);
  }
  return sc;
}
