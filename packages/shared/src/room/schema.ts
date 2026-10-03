import { z } from 'zod';

/** Rooms are pure data. These schemas validate content at load time on both client and server. */

export const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export const vec2Schema = z.tuple([z.number(), z.number()]);

/** Either a `#RRGGBB` hex value or a palette key such as `walnut` (resolved by the renderer). */
export const colorRefSchema = z
  .string()
  .regex(/^(#[0-9a-fA-F]{6}|[a-z][a-zA-Z0-9]*)$/, 'Expected #RRGGBB or a palette key');

export const colliderSchema = z.discriminatedUnion('shape', [
  z.object({
    shape: z.literal('box'),
    center: vec3Schema,
    half: vec3Schema,
    yaw: z.number().optional(),
  }),
  z.object({
    shape: z.literal('cylinder'),
    center: vec3Schema,
    radius: z.number().positive(),
    halfHeight: z.number().positive(),
  }),
]);

export const POSTURES = ['upright', 'lean', 'crossLegged', 'perch'] as const;
export const postureSchema = z.enum(POSTURES);

export const seatDefSchema = z.object({
  /** Seat surface point (where the pelvis rests) in prop-local space. */
  offset: vec3Schema,
  /** Facing relative to the prop. The prop front is +Z. */
  yaw: z.number().optional(),
  posture: postureSchema,
  /** Optional camera eye override in prop-local space. */
  eye: vec3Schema.optional(),
  /**
   * Where the avatar stands before sitting / after standing, prop-local XZ. Defaults to a point in
   * front of the seat; chairs tucked under a table stand up behind or beside the chair instead.
   */
  approach: vec2Schema.optional(),
});

export const interactionDefSchema = z.object({
  kind: z.string().min(1).max(32),
  offset: vec3Schema,
  radius: z.number().positive().max(6),
  promptKey: z.string().max(64).optional(),
});

export const propDefSchema = z.object({
  type: z.string().min(1).max(48),
  colliders: z.array(colliderSchema).max(32),
  /**
   * Sized props (tables, counters): adds a box collider from the instance params
   * `width`, `depth`, `height`, resting on the floor at the prop origin.
   */
  boxFromParams: z.boolean().optional(),
  seats: z.array(seatDefSchema).max(16).optional(),
  interactions: z.array(interactionDefSchema).max(8).optional(),
  /** Static props are merged into batched geometry by the renderer. */
  dynamic: z.boolean().optional(),
  /** Low collider tops of this prop are floor you can walk on (steps, stages). */
  walkable: z.boolean().optional(),
  /** Mounted on the ceiling: hidden when the camera looks into the room from above. */
  ceiling: z.boolean().optional(),
  /**
   * A basketball hoop: the rim's center (prop-local) and inner radius. Balls dropping through the
   * rim score; the rim and backboard themselves are ordinary colliders of the prop.
   */
  goal: z.object({ offset: vec3Schema, radius: z.number().positive().max(1) }).optional(),
});

export const propCatalogSchema = z.array(propDefSchema);

const paramValue = z.union([z.number(), z.string().max(64), z.boolean()]);

export const propInstanceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  type: z.string().min(1).max(48),
  position: vec3Schema,
  yaw: z.number().optional(),
  scale: z.number().positive().max(10).optional(),
  color: colorRefSchema.optional(),
  accent: colorRefSchema.optional(),
  variant: z.string().max(32).optional(),
  params: z.record(z.string(), paramValue).optional(),
});

export const voiceZoneSchema = z.object({
  id: z.string().min(1).max(32),
  mode: z.enum(['global', 'proximity']),
  min: vec2Schema,
  max: vec2Schema,
});

/** A flat, wall-mounted rectangle facing along `yaw` (0 faces +Z). */
export const wallRectSchema = z.object({
  center: vec3Schema,
  width: z.number().positive(),
  height: z.number().positive(),
  yaw: z.number(),
});

export const screenSchema = wallRectSchema.extend({
  bezel: z.number().nonnegative(),
});

/** Writable whiteboards (drawn on in board mode). */
export const boardSchema = wallRectSchema.extend({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
});

export const LIGHT_ROLES = ['house', 'wash', 'accent'] as const;
export type LightRole = (typeof LIGHT_ROLES)[number];

/**
 * One real-time light of the room rig. Fixtures (props) are emissive geometry only; the rig is
 * explicit so the light count stays within the forward-rendering budget. Roles drive light scenes.
 */
export const lightDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  /** `directional` = the diffuse "light field" of a regular ceiling grid (soft, near-vertical). */
  kind: z.enum(['spot', 'point', 'area', 'directional']),
  role: z.enum(LIGHT_ROLES),
  position: vec3Schema,
  /** Spot / area aim point (defaults to straight down). */
  target: vec3Schema.optional(),
  color: colorRefSchema.optional(),
  /** Candela for spot/point lights, nits for area lights. */
  intensity: z.number().nonnegative(),
  angle: z.number().positive().max(1.57).optional(),
  penumbra: z.number().min(0).max(1).optional(),
  distance: z.number().nonnegative().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  castShadow: z.boolean().optional(),
  /** Lowest quality level that still creates this light. */
  minQuality: z.enum(['low', 'medium', 'high']).optional(),
});

/** Indoor lighting: an explicit light rig plus ambient and image-based fill. */
export const lightingSchema = z.object({
  /** Default tint of the ceiling fixtures (neutral white ~4000 K for offices). */
  fixtureColor: colorRefSchema,
  /** Global multiplier on rig intensities. */
  fixtureIntensity: z.number().nonnegative(),
  ambientColor: colorRefSchema,
  ambientIntensity: z.number().nonnegative(),
  envIntensity: z.number().nonnegative(),
  exposure: z.number().positive(),
  lights: z.array(lightDefSchema).max(24).optional(),
});

export const WALLS = ['north', 'south', 'east', 'west'] as const;
export type WallSide = (typeof WALLS)[number];

export const architectureSchema = z.object({
  width: z.number().positive().max(200),
  depth: z.number().positive().max(200),
  height: z.number().positive().max(50),
  wallThickness: z.number().positive().max(2),
  floor: z.enum(['carpet', 'wood', 'concrete']),
  floorColor: colorRefSchema,
  wallColors: z.object({
    north: colorRefSchema,
    south: colorRefSchema,
    east: colorRefSchema,
    west: colorRefSchema,
  }),
  ceilingColor: colorRefSchema,
  baseboardColor: colorRefSchema,
  /** Raised ceiling coffer with an indirect LED cove (typical boardroom detail). */
  tray: z
    .object({
      center: vec2Schema,
      size: vec2Schema,
      rise: z.number().positive().max(1),
    })
    .optional(),
  doors: z
    .array(
      z.object({
        id: z.string().max(32),
        wall: z.enum(WALLS),
        offset: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        color: colorRefSchema.optional(),
        target: z.string().max(40).optional(),
      }),
    )
    .max(8),
});

export const decalSchema = z.object({
  position: vec3Schema,
  normal: vec3Schema,
  size: z.number().positive().max(20),
  rotation: z.number(),
  color: colorRefSchema,
  variant: z.number().int().min(0).max(15),
});

export const spawnSchema = z.object({ position: vec3Schema, yaw: z.number() });

export const roomDataSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(64),
  version: z.literal(1),
  architecture: architectureSchema,
  lighting: lightingSchema,
  screen: screenSchema,
  boards: z.array(boardSchema).max(8).optional(),
  spawns: z.array(spawnSchema).min(1).max(64),
  voiceZones: z.array(voiceZoneSchema).max(32),
  props: z.array(propInstanceSchema).max(2000),
  colliders: z.array(colliderSchema).max(500).optional(),
  decals: z.array(decalSchema).max(64).optional(),
  overviewCamera: z.object({ position: vec3Schema, target: vec3Schema }).optional(),
});

export type ColliderDef = z.infer<typeof colliderSchema>;
export type Posture = z.infer<typeof postureSchema>;
export type SeatDef = z.infer<typeof seatDefSchema>;
export type InteractionDef = z.infer<typeof interactionDefSchema>;
export type PropDef = z.infer<typeof propDefSchema>;
export type PropInstance = z.infer<typeof propInstanceSchema>;
export type VoiceZone = z.infer<typeof voiceZoneSchema>;
export type WallRect = z.infer<typeof wallRectSchema>;
export type ScreenDef = z.infer<typeof screenSchema>;
export type BoardDef = z.infer<typeof boardSchema>;
export type LightingDef = z.infer<typeof lightingSchema>;
export type LightDef = z.infer<typeof lightDefSchema>;
export type ArchitectureDef = z.infer<typeof architectureSchema>;
export type DecalDef = z.infer<typeof decalSchema>;
export type RoomData = z.infer<typeof roomDataSchema>;
