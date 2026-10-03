import type { Vec3Tuple } from '../math/vec3.ts';
import type {
  BoardDef,
  ColliderDef,
  PropDef,
  PropInstance,
  Posture,
  RoomData,
  ScreenDef,
  VoiceZone,
} from './schema.ts';

export interface ResolvedBox {
  shape: 'box';
  center: Vec3Tuple;
  half: Vec3Tuple;
  yaw: number;
  /** Originating prop id, or `arch` for walls/floor/ceiling. */
  source: string;
  /** Top surface can be walked on (tiers, stages, the floor slab). */
  walkable: boolean;
}

export interface ResolvedCylinder {
  shape: 'cylinder';
  center: Vec3Tuple;
  radius: number;
  halfHeight: number;
  source: string;
  walkable: boolean;
}

export type ResolvedCollider = ResolvedBox | ResolvedCylinder;

export interface ResolvedSeat {
  id: string;
  propId: string;
  propType: string;
  /** Seat surface point in world space (pelvis rests here). */
  position: Vec3Tuple;
  /** World yaw the seated avatar faces. */
  yaw: number;
  posture: Posture;
  /** Approximate eye position of a seated avatar, world space. */
  eye: Vec3Tuple;
  /** Explicit stand-up point (world XZ, y = prop floor), or null for "in front of the seat". */
  approach: Vec3Tuple | null;
}

export interface ResolvedInteractable {
  id: string;
  kind: string;
  propId: string;
  position: Vec3Tuple;
  radius: number;
  yaw: number;
  promptKey: string | undefined;
}

/** A basketball hoop: balls dropping down through the rim circle score. */
export interface ResolvedGoal {
  /** The hoop prop's id. */
  id: string;
  /** Rim center (world). */
  position: Vec3Tuple;
  /** Inner rim radius. */
  radius: number;
  /** Facing of the hoop (the backboard is behind the rim along -facing). */
  yaw: number;
}

export interface ResolvedRoom {
  data: RoomData;
  bounds: { min: Vec3Tuple; max: Vec3Tuple };
  colliders: ResolvedCollider[];
  seats: ResolvedSeat[];
  interactables: ResolvedInteractable[];
  goals: ResolvedGoal[];
  screen: ScreenDef;
  boards: BoardDef[];
  voiceZones: VoiceZone[];
  /** Prop ids mounted on the ceiling (hidden in the top-down cutaway view). */
  ceilingProps: Set<string>;
}

/** Eye height above the seat surface and forward offset per posture (meters). */
const POSTURE_EYE: Record<Posture, { up: number; forward: number }> = {
  upright: { up: 0.74, forward: 0.02 },
  lean: { up: 0.66, forward: -0.12 },
  crossLegged: { up: 0.7, forward: 0.0 },
  perch: { up: 0.76, forward: 0.04 },
};

function rotate(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

function toWorld(p: Vec3Tuple, inst: PropInstance, scale: number): Vec3Tuple {
  const yaw = inst.yaw ?? 0;
  const [rx, rz] = rotate(p[0] * scale, p[2] * scale, yaw);
  return [inst.position[0] + rx, inst.position[1] + p[1] * scale, inst.position[2] + rz];
}

function resolveCollider(
  def: ColliderDef,
  inst: PropInstance,
  scale: number,
  walkable: boolean,
): ResolvedCollider {
  const center = toWorld(def.center, inst, scale);
  if (def.shape === 'box') {
    return {
      shape: 'box',
      center,
      half: [def.half[0] * scale, def.half[1] * scale, def.half[2] * scale],
      yaw: (inst.yaw ?? 0) + (def.yaw ?? 0),
      source: inst.id,
      walkable,
    };
  }
  return {
    shape: 'cylinder',
    center,
    radius: def.radius * scale,
    halfHeight: def.halfHeight * scale,
    source: inst.id,
    walkable,
  };
}

function architectureColliders(room: RoomData): ResolvedCollider[] {
  const a = room.architecture;
  const hw = a.width / 2;
  const hd = a.depth / 2;
  const t = a.wallThickness;
  const box = (center: Vec3Tuple, half: Vec3Tuple, walkable = false): ResolvedBox => ({
    shape: 'box',
    center,
    half,
    yaw: 0,
    source: 'arch',
    walkable,
  });
  return [
    box([0, -0.25, 0], [hw + t, 0.25, hd + t], true),
    box([0, a.height + 0.25, 0], [hw + t, 0.25, hd + t]),
    box([0, a.height / 2, -hd - t / 2], [hw + t, a.height / 2, t / 2]),
    box([0, a.height / 2, hd + t / 2], [hw + t, a.height / 2, t / 2]),
    box([-hw - t / 2, a.height / 2, 0], [t / 2, a.height / 2, hd]),
    box([hw + t / 2, a.height / 2, 0], [t / 2, a.height / 2, hd]),
  ];
}

export class RoomResolveError extends Error {
  override name = 'RoomResolveError';
}

/** Reads a required positive numeric param from a prop instance. */
export function numParam(inst: PropInstance, key: string, fallback?: number): number {
  const v = inst.params?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (fallback !== undefined) return fallback;
  throw new RoomResolveError(`Prop "${inst.id}" needs numeric param "${key}"`);
}

/**
 * Expands prop instances using the prop catalog into world-space colliders, seats and
 * interactables. Pure and deterministic, so the server and every client agree on seat ids.
 */
export function resolveRoom(room: RoomData, catalog: readonly PropDef[]): ResolvedRoom {
  const defs = new Map(catalog.map((d) => [d.type, d]));
  const colliders: ResolvedCollider[] = architectureColliders(room);
  const seats: ResolvedSeat[] = [];
  const interactables: ResolvedInteractable[] = [];
  const goals: ResolvedGoal[] = [];
  const seenIds = new Set<string>();
  const ceilingProps = new Set<string>();

  for (const extra of room.colliders ?? []) {
    colliders.push(
      resolveCollider(extra, { id: 'extra', type: 'extra', position: [0, 0, 0] }, 1, false),
    );
  }

  for (const inst of room.props) {
    if (seenIds.has(inst.id)) throw new RoomResolveError(`Duplicate prop id "${inst.id}"`);
    seenIds.add(inst.id);
    const def = defs.get(inst.type);
    if (!def) throw new RoomResolveError(`Unknown prop type "${inst.type}" (${inst.id})`);
    const scale = inst.scale ?? 1;
    const propYaw = inst.yaw ?? 0;
    if (def.ceiling) ceilingProps.add(inst.id);

    const walkable = def.walkable ?? false;
    for (const c of def.colliders) colliders.push(resolveCollider(c, inst, scale, walkable));
    if (def.boxFromParams) {
      const w = numParam(inst, 'width');
      const d = numParam(inst, 'depth');
      const h = numParam(inst, 'height');
      colliders.push(
        resolveCollider(
          { shape: 'box', center: [0, h / 2, 0], half: [w / 2, h / 2, d / 2] },
          inst,
          scale,
          walkable,
        ),
      );
    }

    def.seats?.forEach((s, index) => {
      const yaw = propYaw + (s.yaw ?? 0);
      const position = toWorld(s.offset, inst, scale);
      let eye: Vec3Tuple;
      if (s.eye) {
        eye = toWorld(s.eye, inst, scale);
      } else {
        const e = POSTURE_EYE[s.posture];
        eye = [
          position[0] + Math.sin(yaw) * e.forward,
          position[1] + e.up,
          position[2] + Math.cos(yaw) * e.forward,
        ];
      }
      const approach = s.approach ? toWorld([s.approach[0], 0, s.approach[1]], inst, scale) : null;
      seats.push({
        id: `${inst.id}.${index}`,
        propId: inst.id,
        propType: inst.type,
        position,
        yaw,
        posture: s.posture,
        eye,
        approach,
      });
    });

    def.interactions?.forEach((it, index) => {
      interactables.push({
        id: `${inst.id}:${it.kind}${index === 0 ? '' : `.${index}`}`,
        kind: it.kind,
        propId: inst.id,
        position: toWorld(it.offset, inst, scale),
        radius: it.radius * scale,
        yaw: propYaw,
        promptKey: it.promptKey,
      });
    });

    if (def.goal) {
      goals.push({
        id: inst.id,
        position: toWorld(def.goal.offset, inst, scale),
        radius: def.goal.radius * scale,
        yaw: propYaw,
      });
    }
  }

  const a = room.architecture;
  return {
    data: room,
    bounds: {
      min: [-a.width / 2, 0, -a.depth / 2],
      max: [a.width / 2, a.height, a.depth / 2],
    },
    colliders,
    seats,
    interactables,
    goals,
    screen: room.screen,
    boards: room.boards ?? [],
    voiceZones: room.voiceZones,
    ceilingProps,
  };
}

/** Returns the voice zone containing an XZ point, or undefined when outside all zones. */
export function voiceZoneAt(
  zones: readonly VoiceZone[],
  x: number,
  z: number,
): VoiceZone | undefined {
  for (const zone of zones) {
    if (x >= zone.min[0] && x <= zone.max[0] && z >= zone.min[1] && z <= zone.max[1]) return zone;
  }
  return undefined;
}

/** True when an XZ point lies inside the room footprint shrunk by `margin`. */
export function insideRoom(room: ResolvedRoom, x: number, z: number, margin = 0): boolean {
  return (
    x >= room.bounds.min[0] + margin &&
    x <= room.bounds.max[0] - margin &&
    z >= room.bounds.min[2] + margin &&
    z <= room.bounds.max[2] - margin
  );
}
