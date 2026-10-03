import type { CanvasFactory } from '@huddle/platform';
import {
  createRng,
  hashString,
  type PropInstance,
  type ResolvedRoom,
  type Rng,
} from '@huddle/shared';
import * as THREE from 'three';
import type { PartList } from '../geometry/parts.ts';
import type { MaterialLibrary } from '../materials/library.ts';
import type { PlayHandles } from './play-handles.ts';

/** Per-frame updater for dynamic prop pieces (clock hands, blinking LEDs). */
export type PropUpdater = (timeSeconds: number, wallMs: number) => void;

export interface BuildContext {
  readonly room: ResolvedRoom;
  readonly library: MaterialLibrary;
  readonly canvas: CanvasFactory;
  /** Linear-space color from a palette key or hex, with a fallback reference. */
  color(ref: string | undefined, fallback: string): THREE.Color;
  /** Emissive color (linear, scaled; values above ~1 bloom). */
  emissive(ref: string | undefined, fallback: string, intensity?: number): THREE.Color;
  /** Deterministic RNG seeded by the prop id, so every client builds identical props. */
  rng(inst: PropInstance): Rng;
  /** Adds a non-batched object (world transform already set) to the scene. */
  addDynamic(object: THREE.Object3D, updater?: PropUpdater): void;
  /** Registers an object for selective bloom. */
  addBloom(object: THREE.Object3D): void;
  /** Where playful props register their live pieces (hoop nets, scoreboards). */
  readonly play: PlayHandles;
}

export type PropBuilder = (inst: PropInstance, ctx: BuildContext, parts: PartList) => void;

export interface ContextOptions {
  room: ResolvedRoom;
  library: MaterialLibrary;
  canvas: CanvasFactory;
  resolveColor: (ref: string) => string;
  dynamicRoot: THREE.Object3D;
  bloom: THREE.Object3D[];
  updaters: PropUpdater[];
  play: PlayHandles;
}

export function createBuildContext(o: ContextOptions): BuildContext {
  const cache = new Map<string, THREE.Color>();
  const color = (ref: string | undefined, fallback: string): THREE.Color => {
    const key = ref ?? fallback;
    let c = cache.get(key);
    if (!c) {
      // THREE.Color parses sRGB hex into the linear working color space.
      c = new THREE.Color(o.resolveColor(key));
      cache.set(key, c);
    }
    return c;
  };
  return {
    room: o.room,
    library: o.library,
    canvas: o.canvas,
    color,
    emissive: (ref, fallback, intensity = 2) =>
      color(ref, fallback).clone().multiplyScalar(intensity),
    rng: (inst) => createRng(hashString(inst.id)),
    addDynamic: (object, updater) => {
      o.dynamicRoot.add(object);
      if (updater) o.updaters.push(updater);
    },
    addBloom: (object) => {
      o.bloom.push(object);
    },
    play: o.play,
  };
}

/** Lighter/darker variants for trims, reveals and shading. */
export function tint(c: THREE.Color, towards: THREE.Color, amount: number): THREE.Color {
  return c.clone().lerp(towards, amount);
}

/** Multiplies a color (e.g. darker reveals and shadow gaps). */
export function shade(c: THREE.Color, factor: number): THREE.Color {
  return c.clone().multiplyScalar(factor);
}

export const WHITE = new THREE.Color(1, 1, 1);
export const BLACK = new THREE.Color(0, 0, 0);

export function propMatrix(inst: PropInstance): THREE.Matrix4 {
  const s = inst.scale ?? 1;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(inst.position[0], inst.position[1], inst.position[2]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.yaw ?? 0),
    new THREE.Vector3(s, s, s),
  );
}

export function paramNumber(inst: PropInstance, key: string, fallback: number): number {
  const v = inst.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function paramString(inst: PropInstance, key: string, fallback: string): string {
  const v = inst.params?.[key];
  return typeof v === 'string' ? v : fallback;
}
