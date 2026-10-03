import RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER, type ResolvedCollider, type Vec3 } from '@huddle/shared';

/** Collision membership bits (Rapier InteractionGroups: membership << 16 | filter). */
export const CollisionGroup = {
  static: 0x0001,
  character: 0x0002,
  projectile: 0x0004,
  prop: 0x0008,
} as const;

export function interactionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

const STATIC_GROUPS = interactionGroups(CollisionGroup.static, 0xffff);
// Characters do not collide with projectiles in the controller's own sweeps (a duck on the floor
// must not block walking), but projectiles still bounce off characters.
const CHARACTER_GROUPS = interactionGroups(
  CollisionGroup.character,
  CollisionGroup.static |
    CollisionGroup.character |
    CollisionGroup.prop |
    CollisionGroup.projectile,
);
const CHARACTER_SWEEP = interactionGroups(
  CollisionGroup.character,
  CollisionGroup.static | CollisionGroup.character | CollisionGroup.prop,
);
/** "Don't hit me": thrown objects pass through this character. */
const CHARACTER_GHOST_GROUPS = interactionGroups(
  CollisionGroup.character,
  CollisionGroup.static | CollisionGroup.character | CollisionGroup.prop,
);
const PROJECTILE_GROUPS = interactionGroups(
  CollisionGroup.projectile,
  CollisionGroup.static |
    CollisionGroup.character |
    CollisionGroup.prop |
    CollisionGroup.projectile,
);
const STATIC_QUERY = interactionGroups(0xffff, CollisionGroup.static);

/** Physical description of a thrown object's body. */
export interface ProjectileBodyDef {
  shape: 'ball' | 'box';
  /** Ball radius, or box half extents. */
  radius: number;
  half?: [number, number, number];
  density: number;
  restitution: number;
  friction: number;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
}

export interface ProjectileBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

let initPromise: Promise<void> | null = null;

/** Loads the Rapier WASM module once (async, never blocks the main thread on import). */
export function initPhysics(): Promise<void> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

export interface RayHit {
  distance: number;
  normal: Vec3;
}

export class CharacterBody {
  readonly position: Vec3;
  grounded = false;
  /** Player id owning this body (for projectile hits). */
  ownerId = '';
  /**
   * False for people on other clients: walkers pass through them, since their interpolated pose
   * lags and two clients must never wedge each other in place. Throws still hit them.
   */
  blocksWalkers = true;
  private readonly walkFilter: (c: RAPIER.Collider) => boolean;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly world: RAPIER.World;
  private readonly centerOffset: number;
  private readonly desired = { x: 0, y: 0, z: 0 };
  private readonly next = { x: 0, y: 0, z: 0 };
  private enabled = true;

  constructor(
    world: RAPIER.World,
    position: Vec3,
    radius: number,
    height: number,
    walkFilter: (c: RAPIER.Collider) => boolean,
  ) {
    this.world = world;
    this.walkFilter = walkFilter;
    const halfHeight = Math.max(0.01, height / 2 - radius);
    this.centerOffset = height / 2;
    this.position = { x: position.x, y: position.y, z: position.z };
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      position.x,
      position.y + this.centerOffset,
      position.z,
    );
    this.body = world.createRigidBody(desc);
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(CHARACTER_GROUPS),
      this.body,
    );
    const c = world.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    c.enableAutostep(0.32, 0.18, false);
    c.enableSnapToGround(0.25);
    c.setSlideEnabled(true);
    c.setApplyImpulsesToDynamicBodies(true);
    c.setCharacterMass(70);
    this.controller = c;
  }

  /** Moves by `delta` (meters) with collision and sliding; updates `position` and `grounded`. */
  move(delta: Vec3): void {
    if (!this.enabled) return;
    this.desired.x = delta.x;
    this.desired.y = delta.y;
    this.desired.z = delta.z;
    this.controller.computeColliderMovement(
      this.collider,
      this.desired,
      undefined,
      CHARACTER_SWEEP,
      this.walkFilter,
    );
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    this.next.x = t.x + m.x;
    this.next.y = t.y + m.y;
    this.next.z = t.z + m.z;
    this.body.setNextKinematicTranslation(this.next);
    this.position.x = this.next.x;
    this.position.y = this.next.y - this.centerOffset;
    this.position.z = this.next.z;
  }

  teleport(p: Vec3): void {
    this.body.setTranslation({ x: p.x, y: p.y + this.centerOffset, z: p.z }, true);
    this.position.x = p.x;
    this.position.y = p.y;
    this.position.z = p.z;
  }

  /** Disables collision (e.g. while seated) so the body neither blocks nor gets blocked. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.collider.setEnabled(enabled);
  }

  /** Whether thrown objects bounce off this body (off for "Don't hit me"). */
  setProjectileContact(on: boolean): void {
    this.collider.setCollisionGroups(on ? CHARACTER_GROUPS : CHARACTER_GHOST_GROUPS);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  get colliderHandle(): number {
    return this.collider.handle;
  }

  /** Capsule center in world space. */
  center(out: Vec3): Vec3 {
    const t = this.body.translation();
    out.x = t.x;
    out.y = t.y;
    out.z = t.z;
    return out;
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}

/** Thin, allocation-conscious wrapper over a Rapier world. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private readonly characters = new Set<CharacterBody>();
  private readonly byCollider = new Map<number, CharacterBody>();
  /** Character sweeps ignore people who don't block walkers (see `CharacterBody.blocksWalkers`). */
  private readonly walkFilter = (c: RAPIER.Collider): boolean =>
    this.byCollider.get(c.handle)?.blocksWalkers !== false;
  private readonly events = new RAPIER.EventQueue(true);

  private constructor(gravityY: number) {
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
  }

  static async create(gravityY = -9.81): Promise<PhysicsWorld> {
    await initPhysics();
    return new PhysicsWorld(gravityY);
  }

  addStaticColliders(colliders: readonly ResolvedCollider[]): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const c of colliders) {
      let desc: RAPIER.ColliderDesc;
      if (c.shape === 'box') {
        desc = RAPIER.ColliderDesc.cuboid(c.half[0], c.half[1], c.half[2]);
        if (c.yaw !== 0) {
          const h = c.yaw / 2;
          desc.setRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) });
        }
      } else {
        desc = RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius);
      }
      desc.setTranslation(c.center[0], c.center[1], c.center[2]);
      desc.setCollisionGroups(STATIC_GROUPS).setFriction(0.8);
      this.world.createCollider(desc, body);
    }
  }

  createCharacter(
    position: Vec3,
    radius: number = PLAYER.radius,
    height: number = PLAYER.height,
  ): CharacterBody {
    const c = new CharacterBody(this.world, position, radius, height, this.walkFilter);
    this.characters.add(c);
    this.byCollider.set(c.colliderHandle, c);
    return c;
  }

  removeCharacter(c: CharacterBody): void {
    if (!this.characters.delete(c)) return;
    this.byCollider.delete(c.colliderHandle);
    c.dispose();
  }

  /** The character owning a collider, if any. */
  characterOf(colliderHandle: number): CharacterBody | undefined {
    return this.byCollider.get(colliderHandle);
  }

  /** A dynamic, continuously collided body reporting collision events (thrown objects). */
  createProjectile(
    def: ProjectileBodyDef,
    position: Vec3,
    velocity: Vec3,
    spin: Vec3,
  ): ProjectileBody {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setAngvel(spin)
      .setGravityScale(def.gravityScale)
      .setLinearDamping(def.linearDamping)
      .setAngularDamping(def.angularDamping)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    const shape =
      def.shape === 'box' && def.half
        ? RAPIER.ColliderDesc.cuboid(def.half[0], def.half[1], def.half[2])
        : RAPIER.ColliderDesc.ball(def.radius);
    shape
      .setDensity(def.density)
      .setRestitution(def.restitution)
      .setFriction(def.friction)
      .setCollisionGroups(PROJECTILE_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(shape, body);
    return { body, collider };
  }

  removeProjectile(p: ProjectileBody): void {
    this.world.removeRigidBody(p.body);
  }

  /** Collision start/stop events since the last step. */
  drainCollisions(visit: (handle1: number, handle2: number, started: boolean) => void): void {
    this.events.drainCollisionEvents(visit);
  }

  /** Distance to the first static surface along `dir` (unit), or `Infinity`. */
  raycastStatic(origin: Vec3, dir: Vec3, maxDistance: number): number {
    const hit = this.castRay(origin, dir, maxDistance, STATIC_QUERY);
    return hit ? hit.timeOfImpact : Number.POSITIVE_INFINITY;
  }

  /** Raycast against static geometry returning the surface normal. Allocates a result. */
  raycastStaticWithNormal(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null {
    this.setRay(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxDistance,
      true,
      undefined,
      STATIC_QUERY,
    );
    if (!hit) return null;
    return {
      distance: hit.timeOfImpact,
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    };
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.events);
  }

  dispose(): void {
    for (const c of this.characters) c.dispose();
    this.characters.clear();
    this.byCollider.clear();
    this.events.free();
    this.world.free();
  }

  private setRay(origin: Vec3, dir: Vec3): void {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    this.ray.dir.x = dir.x;
    this.ray.dir.y = dir.y;
    this.ray.dir.z = dir.z;
  }

  private castRay(
    origin: Vec3,
    dir: Vec3,
    max: number,
    groups: number,
  ): RAPIER.RayColliderHit | null {
    this.setRay(origin, dir);
    return this.world.castRay(this.ray, max, true, undefined, groups);
  }
}
