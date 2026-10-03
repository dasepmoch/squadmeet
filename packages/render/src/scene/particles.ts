import * as THREE from 'three';

export type ParticleStyle = 'confetti' | 'hearts' | 'juice' | 'stars' | 'paper' | 'sparkle';

interface Particle {
  alive: boolean;
  shape: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Rotation axis (unit) and angle. */
  ax: number;
  ay: number;
  az: number;
  angle: number;
  spin: number;
  size: number;
  age: number;
  life: number;
  gravity: number;
  drag: number;
  /** 1 = sways like paper while sinking. */
  flutter: number;
  floor: number;
  readonly color: THREE.Color;
}

const CONFETTI_COLORS = [
  '#FF5A1F',
  '#2F5BFF',
  '#FF2E93',
  '#B6FF2E',
  '#7B3CFF',
  '#00D9C0',
  '#FFD21F',
  '#FFFFFF',
].map((h) => new THREE.Color(h));
const HEART_COLORS = ['#FF3B6B', '#FF6F91', '#FF2E93', '#FF9EB5'].map((h) => new THREE.Color(h));
const JUICE = [new THREE.Color('#C9261A'), new THREE.Color('#E0452B')];
const STAR = [new THREE.Color('#FFF3B0'), new THREE.Color('#FFD21F')];
const PAPER = [new THREE.Color('#F5F2EA')];
/** The "Don't hit me" shimmer: cyan and white glints. */
const GHOST = [new THREE.Color('#7DF9FF'), new THREE.Color('#E6FDFF'), new THREE.Color('#38D6FF')];
const CAPACITY = 900;

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const axis = new THREE.Vector3();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();

/**
 * Cosmetic particle bursts (confetti, floating hearts, tomato juice, impact stars) as a few
 * instanced meshes: one draw call per shape, zero allocations per frame.
 */
export class ParticleLayer {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[];
  private readonly particles: Particle[] = [];
  private readonly dir = new THREE.Vector3();
  private cursor = 0;
  private active = 0;

  constructor(heartGeometry: THREE.BufferGeometry) {
    this.group.name = 'particles';
    const quad = new THREE.PlaneGeometry(1, 0.6);
    const drop = new THREE.IcosahedronGeometry(0.5, 1);
    const star = new THREE.OctahedronGeometry(0.5, 0);
    // The throwable heart is ~10 cm wide; normalize to ~1 m so `size` is in meters.
    const heart = heartGeometry.clone();
    heart.scale(10, 10, 10);
    const matte = new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide });
    const glossy = new THREE.MeshPhysicalMaterial({ roughness: 0.2, clearcoat: 0.8 });
    const glow = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.meshes = [
      new THREE.InstancedMesh(quad, matte, CAPACITY),
      new THREE.InstancedMesh(heart, glossy, 160),
      new THREE.InstancedMesh(drop, glossy, 240),
      new THREE.InstancedMesh(star, glow, 220),
    ];
    for (const m of this.meshes) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(m);
    }
    for (let i = 0; i < CAPACITY; i++) {
      this.particles.push({
        alive: false,
        shape: 0,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        ax: 0,
        ay: 1,
        az: 0,
        angle: 0,
        spin: 0,
        size: 0,
        age: 0,
        life: 0,
        gravity: 0,
        drag: 0,
        flutter: 0,
        floor: 0,
        color: new THREE.Color(1, 1, 1),
      });
    }
  }

  get count(): number {
    return this.active;
  }

  /** Spawns a burst at a point; `normal` biases the spray (splats spray away from the wall). */
  burst(
    style: ParticleStyle,
    at: { x: number; y: number; z: number },
    normal: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 },
    reduced = false,
  ): void {
    const n = { confetti: 110, hearts: 14, juice: 20, stars: 9, paper: 8, sparkle: 14 }[style];
    const count = reduced ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const p = this.alloc();
      p.x = at.x;
      p.y = at.y;
      p.z = at.z;
      p.age = 0;
      p.angle = Math.random() * Math.PI * 2;
      const ax = Math.random() - 0.5;
      const ay = Math.random() - 0.5;
      const az = Math.random() - 0.5;
      const al = Math.hypot(ax, ay, az) || 1;
      p.ax = ax / al;
      p.ay = ay / al;
      p.az = az / al;
      p.floor = 0.006;
      const dir = this.sprayDirection(normal, style === 'juice' || style === 'stars' ? 0.9 : 1.4);
      let color: THREE.Color;
      switch (style) {
        case 'confetti': {
          const speed = 1.6 + Math.random() * 3.6;
          p.vx = dir.x * speed;
          p.vy = dir.y * speed + 1.2;
          p.vz = dir.z * speed;
          Object.assign(p, {
            shape: 0,
            size: 0.03 + Math.random() * 0.02,
            life: 2.8 + Math.random() * 2.2,
            gravity: 3.4,
            drag: 2.4,
            spin: 6 + Math.random() * 14,
            flutter: 1,
          });
          color = CONFETTI_COLORS[i % CONFETTI_COLORS.length] as THREE.Color;
          break;
        }
        case 'hearts':
          p.vx = (Math.random() - 0.5) * 0.9;
          p.vy = 0.5 + Math.random() * 0.8;
          p.vz = (Math.random() - 0.5) * 0.9;
          Object.assign(p, {
            shape: 1,
            size: 0.035 + Math.random() * 0.03,
            life: 1.6 + Math.random() * 1.1,
            gravity: -0.25,
            drag: 1.2,
            spin: 1.2,
            flutter: 0,
          });
          p.ax = 0;
          p.ay = 1;
          p.az = 0;
          color = HEART_COLORS[i % HEART_COLORS.length] as THREE.Color;
          break;
        case 'juice': {
          const speed = 1.2 + Math.random() * 2.2;
          p.vx = dir.x * speed;
          p.vy = dir.y * speed + 0.6;
          p.vz = dir.z * speed;
          Object.assign(p, {
            shape: 2,
            size: 0.008 + Math.random() * 0.012,
            life: 0.5 + Math.random() * 0.5,
            gravity: 9.8,
            drag: 0.6,
            spin: 0,
            flutter: 0,
          });
          color = JUICE[i % 2] as THREE.Color;
          break;
        }
        case 'stars': {
          const speed = 1.4 + Math.random() * 1.2;
          p.vx = dir.x * speed;
          p.vy = dir.y * speed * 0.6 + 0.9;
          p.vz = dir.z * speed;
          Object.assign(p, {
            shape: 3,
            size: 0.03 + Math.random() * 0.02,
            life: 0.45 + Math.random() * 0.25,
            gravity: 2,
            drag: 3.5,
            spin: 9,
            flutter: 0,
          });
          color = STAR[i % 2] as THREE.Color;
          break;
        }
        case 'paper': {
          const speed = 0.8 + Math.random() * 1.4;
          p.vx = dir.x * speed;
          p.vy = dir.y * speed + 0.8;
          p.vz = dir.z * speed;
          Object.assign(p, {
            shape: 0,
            size: 0.016 + Math.random() * 0.01,
            life: 1.4 + Math.random() * 0.8,
            gravity: 3,
            drag: 2.6,
            spin: 8,
            flutter: 1,
          });
          color = PAPER[0] as THREE.Color;
          break;
        }
        case 'sparkle': {
          const speed = 0.3 + Math.random() * 0.7;
          p.x += (Math.random() - 0.5) * 0.35;
          p.y += (Math.random() - 0.5) * 0.6;
          p.z += (Math.random() - 0.5) * 0.35;
          p.vx = dir.x * speed;
          p.vy = 0.25 + Math.random() * 0.4;
          p.vz = dir.z * speed;
          Object.assign(p, {
            shape: 3,
            size: 0.018 + Math.random() * 0.018,
            life: 0.5 + Math.random() * 0.45,
            gravity: -0.2,
            drag: 2.5,
            spin: 7,
            flutter: 0,
          });
          color = GHOST[i % GHOST.length] as THREE.Color;
          break;
        }
      }
      p.color.copy(color);
    }
  }

  /** One glowing spark left behind by something flying (Party mode trails). */
  spark(at: { x: number; y: number; z: number }, hue: number): void {
    const p = this.alloc();
    Object.assign(p, {
      x: at.x,
      y: at.y,
      z: at.z,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      vz: (Math.random() - 0.5) * 0.3,
      shape: 3,
      size: 0.022 + Math.random() * 0.016,
      age: 0,
      life: 0.4 + Math.random() * 0.3,
      gravity: 0.4,
      drag: 3,
      spin: 9,
      flutter: 0,
      angle: Math.random() * 6.28,
      floor: 0.006,
    });
    p.color.copy(CONFETTI_COLORS[hue % CONFETTI_COLORS.length] as THREE.Color);
  }

  update(dt: number): void {
    const counts = [0, 0, 0, 0];
    this.active = 0;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      this.active++;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - p.gravity * dt;
      if (p.flutter > 0 && p.vy < 0) {
        // Paper flutters: sideways sway while it sinks.
        p.vx += Math.sin(p.age * 7 + p.angle) * 1.6 * dt;
        p.vz += Math.cos(p.age * 6 + p.angle) * 1.6 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        p.vx = p.vy = p.vz = 0;
        p.spin = 0;
      }
      p.angle += p.spin * dt;
      const fade = 1 - Math.max(0, (p.age - p.life * 0.7) / (p.life * 0.3));
      const grow = p.shape === 3 ? 0.4 + Math.min(1, p.age * 8) : 1;
      axis.set(p.ax, p.ay, p.az);
      q.setFromAxisAngle(axis, p.angle);
      pos.set(p.x, p.y, p.z);
      const s = p.size * Math.max(0, fade) * grow;
      scl.set(s, s, s);
      m4.compose(pos, q, scl);
      const mesh = this.meshes[p.shape] as THREE.InstancedMesh;
      const slot = counts[p.shape] ?? 0;
      counts[p.shape] = slot + 1;
      if (slot >= mesh.instanceMatrix.count) continue;
      mesh.setMatrixAt(slot, m4);
      mesh.setColorAt(slot, p.color);
    }
    this.meshes.forEach((m, i) => {
      m.count = Math.min(counts[i] ?? 0, m.instanceMatrix.count);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  clear(): void {
    for (const p of this.particles) p.alive = false;
    for (const m of this.meshes) m.count = 0;
    this.active = 0;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }

  private alloc(): Particle {
    for (let k = 0; k < CAPACITY; k++) {
      const i = (this.cursor + k) % CAPACITY;
      const p = this.particles[i] as Particle;
      if (!p.alive) {
        this.cursor = (i + 1) % CAPACITY;
        p.alive = true;
        return p;
      }
    }
    // Full: recycle the next slot.
    const p = this.particles[this.cursor] as Particle;
    this.cursor = (this.cursor + 1) % CAPACITY;
    p.alive = true;
    return p;
  }

  /** Random direction in a cone around `normal` (spread in radians). */
  private sprayDirection(
    normal: { x: number; y: number; z: number },
    spread: number,
  ): THREE.Vector3 {
    const d = this.dir.set(normal.x, normal.y, normal.z).normalize();
    d.x += (Math.random() - 0.5) * spread * 2;
    d.y += (Math.random() - 0.5) * spread * 2;
    d.z += (Math.random() - 0.5) * spread * 2;
    return d.normalize();
  }
}
