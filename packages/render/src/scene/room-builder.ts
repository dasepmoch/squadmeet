import type { CanvasFactory } from '@huddle/platform';
import { WALLS, type Logger, type ResolvedRoom, type WallSide } from '@huddle/shared';
import * as THREE from 'three';
import { disposeObject } from '../core/dispose.ts';
import { StaticBatcher } from '../geometry/batcher.ts';
import { PartList } from '../geometry/parts.ts';
import type { MaterialLibrary } from '../materials/library.ts';
import { BLOOMING } from '../materials/material-keys.ts';
import { buildArchitecture } from './architecture.ts';
import { BoardSurface } from './board.ts';
import {
  createBuildContext,
  propMatrix,
  type BuildContext,
  type PropUpdater,
} from './build-context.ts';
import { DecalLayer } from './decals.ts';
import { createRoomLights, type RoomLights } from './lighting.ts';
import { createPlayHandles, type PlayHandles } from './play-handles.ts';
import { PROP_BUILDERS } from './props/index.ts';
import { DISPLAY_DEPTH, MainScreen } from './screen.ts';

export interface RoomSceneOptions {
  room: ResolvedRoom;
  library: MaterialLibrary;
  canvas: CanvasFactory;
  resolveColor: (ref: string) => string;
  logger: Logger;
  areaLight: boolean;
}

export interface CutawayGroups {
  walls: Record<WallSide, THREE.Group>;
  stubs: Record<WallSide, THREE.Group>;
  ceiling: THREE.Group;
}

export interface RoomScene {
  root: THREE.Group;
  lights: RoomLights;
  screen: MainScreen;
  boards: Map<string, BoardSurface>;
  decals: DecalLayer;
  cutaway: CutawayGroups;
  /** Hoop nets and scoreboards. */
  play: PlayHandles;
  /** Objects that glow through selective bloom. */
  bloom: THREE.Object3D[];
  stats: { batches: number; triangles: number; props: number };
  update(dt: number, time: number, wallMs: number, camera: THREE.Camera): void;
  dispose(): void;
}

/** Slim display: black body, narrow bezel, soundbar below and a video-conferencing camera on top. */
function buildDisplayHardware(room: ResolvedRoom, ctx: BuildContext, p: PartList): void {
  const s = room.screen;
  const b = s.bezel;
  const local = new PartList();
  const black = ctx.color('black', 'black');
  local.box([s.width + b * 2, s.height + b * 2, DISPLAY_DEPTH], 'gloss', black, [0, 0, 0], 0.006);
  local.box(
    [s.width * 0.3, s.height * 0.3, 0.04],
    'powder',
    ctx.color('charcoal', 'charcoal'),
    [0, 0, -DISPLAY_DEPTH / 2 - 0.02],
    0.004,
  );
  const bottom = -s.height / 2 - b;
  local.box(
    [s.width * 0.62, 0.075, 0.09],
    'fabric',
    ctx.color('#1E1F22', '#1E1F22'),
    [0, bottom - 0.07, 0.01],
    0.02,
  );
  local.box([s.width * 0.62, 0.012, 0.09], 'powder', black, [0, bottom - 0.03, 0.01], 0.004);
  const top = s.height / 2 + b;
  local.box([0.34, 0.05, 0.06], 'powder', black, [0, top + 0.03, 0.02], 0.012);
  local.cylinder(
    0.014,
    0.014,
    0.004,
    'gloss',
    ctx.color('#101B2E', '#101B2E'),
    [0, top + 0.03, 0.051],
    [Math.PI / 2, 0, 0],
    20,
  );
  local.castShadow = false;
  local.sphere(
    0.002,
    'emissive',
    ctx.emissive('#3CD6A0', '#3CD6A0', 3),
    [0.05, top + 0.03, 0.051],
    [1, 1, 1],
    6,
  );
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(s.center[0], s.center[1], s.center[2]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw),
    new THREE.Vector3(1, 1, 1),
  );
  p.append(local, m);
}

/** Props that hang on a wall and disappear with it in cutaway views. */
const WALL_MOUNTED: ReadonlySet<string> = new Set([
  'art-frame',
  'wall-clock',
  'whiteboard',
  'light-switch',
  'felt-panels',
  'slat-wall',
  'hoop',
  'scoreboard',
]);

/** The wall an XZ point sits against (within 30 cm), if any. */
function wallAt(room: ResolvedRoom, x: number, z: number): WallSide | null {
  const a = room.data.architecture;
  const m = 0.3;
  if (z < -a.depth / 2 + m) return 'north';
  if (z > a.depth / 2 - m) return 'south';
  if (x > a.width / 2 - m) return 'east';
  if (x < -a.width / 2 + m) return 'west';
  return null;
}

function batchGroup(
  parts: PartList | PartList[],
  library: MaterialLibrary,
  name: string,
  bloom: THREE.Object3D[],
  castShadow: boolean,
): { group: THREE.Group; triangles: number } {
  const batcher = new StaticBatcher();
  const lists = Array.isArray(parts) ? parts : [parts];
  for (const list of lists) batcher.addParts(list.parts, new THREE.Matrix4());
  const triangles = batcher.triangleCount;
  const { group, meshes } = batcher.build(library, name);
  for (const [key, list] of meshes) if (BLOOMING.has(key)) bloom.push(...list);
  if (!castShadow) {
    group.traverse((o) => {
      o.castShadow = false;
    });
  }
  return { group, triangles };
}

/** Builds the full lit room from resolved room data. Everything procedural, zero asset files. */
export function buildRoomScene(o: RoomSceneOptions): RoomScene {
  const { room, library } = o;
  const t0 = Date.now();
  const root = new THREE.Group();
  root.name = `room:${room.data.id}`;
  const dynamicRoot = new THREE.Group();
  dynamicRoot.name = 'dynamic-props';
  const bloom: THREE.Object3D[] = [];
  const updaters: PropUpdater[] = [];
  const play = createPlayHandles();
  const ctx = createBuildContext({
    room,
    library,
    canvas: o.canvas,
    resolveColor: o.resolveColor,
    dynamicRoot,
    bloom,
    updaters,
    play,
  });

  const arch = buildArchitecture(room, ctx);
  const propParts = new PartList();
  const ceilingParts = new PartList();
  buildDisplayHardware(room, ctx, propParts);
  let props = 0;
  for (const inst of room.data.props) {
    const builder = PROP_BUILDERS.get(inst.type);
    if (!builder) {
      o.logger.warn(`no visual builder for prop type "${inst.type}"`, { id: inst.id });
      continue;
    }
    const parts = new PartList();
    builder(inst, ctx, parts);
    const side = WALL_MOUNTED.has(inst.type)
      ? wallAt(room, inst.position[0], inst.position[2])
      : null;
    const target = room.ceilingProps.has(inst.id)
      ? ceilingParts
      : side
        ? arch.walls[side]
        : propParts;
    target.append(parts, propMatrix(inst));
    props++;
  }

  let triangles = 0;
  let batches = 0;
  const add = (parts: PartList | PartList[], name: string, cast: boolean): THREE.Group => {
    const b = batchGroup(parts, library, name, bloom, cast);
    triangles += b.triangles;
    batches += b.group.children.length;
    root.add(b.group);
    return b.group;
  };
  add(arch.floor, 'floor', false);
  add(propParts, 'props', true);
  const ceiling = add([arch.ceiling, ceilingParts], 'ceiling', false);
  const walls = {} as Record<WallSide, THREE.Group>;
  const stubs = {} as Record<WallSide, THREE.Group>;
  for (const side of WALLS) {
    walls[side] = add(arch.walls[side], `wall:${side}`, false);
    stubs[side] = add(arch.stubs[side], `stub:${side}`, false);
    stubs[side].visible = false;
  }
  // Dynamic wall pieces (clock hands) hide with their wall in cutaway views.
  for (const child of [...dynamicRoot.children]) {
    const side = wallAt(room, child.position.x, child.position.z);
    if (side) walls[side].add(child);
  }
  root.add(dynamicRoot);

  const lights = createRoomLights(room, library, (ref) => ctx.color(ref, 'neutralWhite').clone());
  root.add(lights.group);

  const screen = new MainScreen(room.screen, o.canvas, o.areaLight);
  root.add(screen.group);
  bloom.push(screen.surface);

  const boards = new Map<string, BoardSurface>();
  for (const def of room.boards) {
    const board = new BoardSurface(def, o.canvas, library);
    boards.set(def.id, board);
    const side = wallAt(room, def.center[0], def.center[2]);
    (side ? walls[side] : root).add(board.mesh);
  }

  const decals = new DecalLayer(library.textures.splats);
  for (const d of room.data.decals ?? []) {
    decals.add(
      d.position,
      d.normal,
      d.size,
      d.rotation,
      ctx.color(d.color, 'tomato'),
      d.variant,
      0,
      0,
    );
  }
  root.add(decals.mesh);

  o.logger.info('room scene built', {
    props,
    batches,
    triangles: Math.round(triangles),
    ms: Date.now() - t0,
  });
  const a = room.data.architecture;
  const hw = a.width / 2;
  const hd = a.depth / 2;
  const cutaway: CutawayGroups = { walls, stubs, ceiling };
  const idle = {
    roomName: room.data.name,
    hint: 'Press Share or step up to the lectern to present',
    now: new Date(),
  };
  return {
    root,
    lights,
    screen,
    boards,
    decals,
    cutaway,
    play,
    bloom,
    stats: { batches, triangles: Math.round(triangles), props },
    update(dt, time, wallMs, camera) {
      library.time.value = time;
      decals.update(time);
      for (const u of updaters) u(time, wallMs);
      idle.now = new Date(wallMs);
      screen.update(dt, idle);
      for (const b of boards.values()) b.update();
      lights.update(dt, time);
      // Cutaway: hide the ceiling from above and any wall the camera is behind.
      const c = camera.position;
      ceiling.visible = c.y < a.height + 0.02;
      const outside: Record<WallSide, boolean> = {
        north: c.z < -hd,
        south: c.z > hd,
        east: c.x > hw,
        west: c.x < -hw,
      };
      for (const side of WALLS) {
        walls[side].visible = !outside[side];
        stubs[side].visible = outside[side];
      }
    },
    dispose() {
      screen.dispose();
      for (const b of boards.values()) b.dispose();
      decals.dispose();
      lights.dispose();
      disposeObject(root, new Set<object>(library.all()));
    },
  };
}
