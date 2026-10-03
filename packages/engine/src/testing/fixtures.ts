import {
  propCatalogSchema,
  resolveRoom,
  roomDataSchema,
  type PropDef,
  type ResolvedRoom,
  type RoomData,
} from '@huddle/shared';

/** Rim of the test hoop: twelve short boxes around the goal (same layout as the content hoop). */
const RIM_SEGMENTS = Array.from({ length: 12 }, (_, k) => {
  const a = (k / 12) * Math.PI * 2;
  return {
    shape: 'box',
    center: [Math.cos(a) * 0.212, 2.16, 0.33 + Math.sin(a) * 0.212],
    half: [0.056, 0.011, 0.011],
    yaw: Math.PI / 2 - a,
  };
});

/** Small deterministic room used by engine tests and headless tools. */
export const TEST_CATALOG: PropDef[] = propCatalogSchema.parse([
  {
    type: 'crate',
    colliders: [{ shape: 'box', center: [0, 0.5, 0], half: [0.5, 0.5, 0.5] }],
  },
  {
    type: 'chair',
    colliders: [{ shape: 'box', center: [0, 0.22, 0], half: [0.3, 0.22, 0.3] }],
    seats: [{ offset: [0, 0.45, 0], posture: 'upright' }],
  },
  {
    type: 'hoop',
    colliders: [
      { shape: 'box', center: [0, 2.31, 0.08], half: [0.45, 0.3, 0.015] },
      ...RIM_SEGMENTS,
    ],
    goal: { offset: [0, 2.16, 0.33], radius: 0.2 },
  },
]);

/** The test room plus a hoop on the east wall (rim at about x 5.67, z -2, 2.16 m up). */
export function makeHoopRoom(): ResolvedRoom {
  const base = makeTestRoomData();
  return makeTestRoom({
    props: [...base.props, { id: 'hoop', type: 'hoop', position: [6, 0, -2], yaw: -Math.PI / 2 }],
  });
}

export function makeTestRoomData(overrides: Partial<RoomData> = {}): RoomData {
  return roomDataSchema.parse({
    id: 'test-room',
    name: 'Test Room',
    version: 1,
    architecture: {
      width: 12,
      depth: 10,
      height: 4,
      wallThickness: 0.3,
      floor: 'carpet',
      floorColor: 'graphite',
      wallColors: { north: 'walnut', south: 'white', east: 'white', west: 'white' },
      ceilingColor: 'white',
      baseboardColor: 'charcoal',
      doors: [],
    },
    lighting: {
      fixtureColor: '#fff1dd',
      fixtureIntensity: 1,
      ambientColor: '#ffe7c7',
      ambientIntensity: 0.3,
      envIntensity: 1,
      exposure: 1,
    },
    boards: [{ id: 'wb', center: [5.9, 1.4, 1], width: 2, height: 1.1, yaw: -Math.PI / 2 }],
    screen: { center: [0, 2, -4.9], width: 4, height: 2.25, yaw: 0, bezel: 0.1 },
    spawns: [{ position: [0, 0, 2], yaw: Math.PI }],
    voiceZones: [{ id: 'meeting', mode: 'global', min: [-6, -5], max: [6, 0] }],
    props: [
      { id: 'crate-1', type: 'crate', position: [0, 0, -1] },
      { id: 'chair-1', type: 'chair', position: [3, 0, 1], yaw: Math.PI },
    ],
    ...overrides,
  });
}

export function makeTestRoom(overrides: Partial<RoomData> = {}): ResolvedRoom {
  return resolveRoom(makeTestRoomData(overrides), TEST_CATALOG);
}
