import { describe, expect, it } from 'vitest';
import { resolveRoom, RoomResolveError, voiceZoneAt } from './resolve.ts';
import { propCatalogSchema, roomDataSchema, type PropDef, type RoomData } from './schema.ts';

const catalog: PropDef[] = propCatalogSchema.parse([
  {
    type: 'stool',
    colliders: [{ shape: 'cylinder', center: [0, 0.35, 0], radius: 0.2, halfHeight: 0.35 }],
    seats: [{ offset: [0, 0.7, 0], posture: 'perch' }],
    interactions: [{ kind: 'seat', offset: [0, 0.5, 0.3], radius: 0.8 }],
  },
  {
    type: 'hoop',
    colliders: [{ shape: 'box', center: [0, 2.3, 0.03], half: [0.4, 0.25, 0.02] }],
    goal: { offset: [0, 2.1, 0.32], radius: 0.2 },
  },
]);

function makeRoom(props: RoomData['props']): RoomData {
  return roomDataSchema.parse({
    id: 'test-room',
    name: 'Test',
    version: 1,
    architecture: {
      width: 10,
      depth: 8,
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
    screen: { center: [0, 2, -3.9], width: 4, height: 2.25, yaw: 0, bezel: 0.1 },
    boards: [{ id: 'wb', center: [4.9, 1.4, 0], width: 2, height: 1.1, yaw: -Math.PI / 2 }],
    spawns: [{ position: [0, 0, 2], yaw: Math.PI }],
    voiceZones: [{ id: 'meeting', mode: 'global', min: [-5, -4], max: [5, 0] }],
    props,
  });
}

describe('resolveRoom', () => {
  it('expands seats with rotation and stable ids', () => {
    const room = makeRoom([{ id: 'stool-a', type: 'stool', position: [2, 0, 1], yaw: Math.PI }]);
    const resolved = resolveRoom(room, catalog);
    expect(resolved.seats).toHaveLength(1);
    const seat = resolved.seats[0]!;
    expect(seat.id).toBe('stool-a.0');
    expect(seat.position[1]).toBeCloseTo(0.7);
    expect(seat.yaw).toBeCloseTo(Math.PI);
    expect(seat.eye[1]).toBeGreaterThan(1.3);
    const interact = resolved.interactables[0]!;
    // Offset +Z rotated by PI ends up on -Z side of the prop.
    expect(interact.position[2]).toBeCloseTo(0.7);
  });

  it('adds architecture colliders and passes boards through', () => {
    const resolved = resolveRoom(makeRoom([]), catalog);
    expect(resolved.colliders.filter((c) => c.source === 'arch')).toHaveLength(6);
    expect(resolved.boards.map((b) => b.id)).toEqual(['wb']);
  });

  it('resolves explicit seat approach points into world space', () => {
    const tucked: PropDef[] = propCatalogSchema.parse([
      {
        type: 'chair',
        colliders: [],
        seats: [{ offset: [0, 0.47, 0], posture: 'upright', approach: [0, -0.6] }],
      },
    ]);
    const resolved = resolveRoom(
      makeRoom([{ id: 'chair-a', type: 'chair', position: [1, 0, 0], yaw: Math.PI / 2 }]),
      tucked,
    );
    const seat = resolved.seats[0]!;
    // Local -Z (behind the chair) rotated by +90 degrees points to world -X.
    expect(seat.approach?.[0]).toBeCloseTo(0.4);
    expect(seat.approach?.[2]).toBeCloseTo(0);
  });

  it('rejects unknown prop types and duplicate ids', () => {
    expect(() =>
      resolveRoom(makeRoom([{ id: 'x', type: 'nope', position: [0, 0, 0] }]), catalog),
    ).toThrow(RoomResolveError);
    expect(() =>
      resolveRoom(
        makeRoom([
          { id: 'a', type: 'stool', position: [0, 0, 0] },
          { id: 'a', type: 'stool', position: [1, 0, 0] },
        ]),
        catalog,
      ),
    ).toThrow(/Duplicate/);
  });

  it('places hoop rims in world space, facing into the room', () => {
    // On the east wall, facing west (-X): the rim sticks out 0.32 m toward the room.
    const room = makeRoom([{ id: 'hoop-e', type: 'hoop', position: [5, 0, 1], yaw: -Math.PI / 2 }]);
    const [goal] = resolveRoom(room, catalog).goals;
    expect(goal?.id).toBe('hoop-e');
    expect(goal?.position[0]).toBeCloseTo(4.68, 6);
    expect(goal?.position[1]).toBeCloseTo(2.1, 6);
    expect(goal?.position[2]).toBeCloseTo(1, 6);
    expect(goal?.radius).toBe(0.2);
  });

  it('finds voice zones', () => {
    const resolved = resolveRoom(makeRoom([]), catalog);
    expect(voiceZoneAt(resolved.voiceZones, 0, -1)?.id).toBe('meeting');
    expect(voiceZoneAt(resolved.voiceZones, 0, 3)).toBeUndefined();
  });
});
