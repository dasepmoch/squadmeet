import * as THREE from 'three';

const CELLS = 4;
const FADE_SECONDS = 2.5;
/** A splat lands small and spreads out (squash), overshooting a little. */
const GROW_SECONDS = 0.18;
/** A mop sweep fades decals quickly, in a wave moving out from where it started. */
const SWEEP_FADE = 0.45;
const SWEEP_SPEED = 7;
const SWEEP_MAX_DELAY = 1.4;

interface DecalSlot {
  permanent: boolean;
  bornAt: number;
  life: number;
  fade: number;
  active: boolean;
  size: number;
  readonly position: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
}

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const tmpN = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Splat size over its first moments (t 0..1): 0.35 → ~1.06 → 1, an ease-out with overshoot. */
export function growCurve(t: number): number {
  if (t >= 1) return 1;
  const x = Math.max(0, t) - 1;
  return 0.35 + 0.65 * (1 + 2.7 * x ** 3 + 1.7 * x ** 2);
}

/**
 * Ink-splat decals as one instanced mesh. The atlas stores a distance-like field thresholded with
 * screen-space derivatives, so splats have crisp edges at any size. Dynamic decals are pooled,
 * capped by a budget, grow in when they land and fade out; permanent decals come from room data.
 */
export class DecalLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly slots: DecalSlot[] = [];
  private readonly cellAttr: THREE.InstancedBufferAttribute;
  private readonly opacityAttr: THREE.InstancedBufferAttribute;
  private readonly capacity: number;
  private budget: number;
  private cursor = 0;

  constructor(atlas: THREE.Texture, capacity = 520) {
    this.capacity = capacity;
    this.budget = capacity;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aDecalUv', geo.getAttribute('uv').clone());
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.opacityAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geo.setAttribute('aCell', this.cellAttr);
    geo.setAttribute('aOpacity', this.opacityAttr);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.3,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSplats = { value: atlas };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec2 aDecalUv;\nattribute float aCell;\nattribute float aOpacity;\nvarying vec2 vDecalUv;\nvarying float vCell;\nvarying float vOpacity;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvDecalUv = aDecalUv;\nvCell = aCell;\nvOpacity = aOpacity;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D uSplats;\nvarying vec2 vDecalUv;\nvarying float vCell;\nvarying float vOpacity;',
        )
        .replace(
          '#include <map_fragment>',
          [
            '#include <map_fragment>',
            `vec2 cellXY = vec2(mod(vCell, ${CELLS}.0), floor(vCell / ${CELLS}.0));`,
            `vec2 atlasUv = (vDecalUv * 0.98 + 0.01 + cellXY) / ${CELLS}.0;`,
            SPLAT_INK_GLSL,
            'diffuseColor.a *= vOpacity;',
          ].join('\n'),
        )
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.16, 0.42, splat.g);',
        );
    };
    material.customProgramCacheKey = () => 'huddle-decal';
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.name = 'decals';
    this.mesh.count = 0;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    for (let i = 0; i < capacity; i++) {
      this.slots.push({
        permanent: false,
        bornAt: 0,
        life: 0,
        fade: FADE_SECONDS,
        active: false,
        size: 0,
        position: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
      });
    }
  }

  /** Max simultaneously visible dynamic decals (quality preset). */
  setBudget(budget: number): void {
    this.budget = Math.max(8, Math.min(this.capacity, budget));
  }

  get decalBudget(): number {
    return this.budget;
  }

  /** Adds a decal. `life` in seconds (0 = permanent). Returns the slot index. */
  add(
    position: readonly [number, number, number],
    normal: readonly [number, number, number],
    size: number,
    rotation: number,
    color: THREE.Color,
    variant: number,
    time: number,
    life = 0,
  ): number {
    const permanent = life === 0;
    const index = this.allocate(permanent);
    const slot = this.slots[index] as DecalSlot;
    tmpN.set(normal[0], normal[1], normal[2]).normalize();
    slot.rotation.setFromUnitVectors(Z, tmpN).multiply(tmpQ2.setFromAxisAngle(Z, rotation));
    slot.position.set(position[0], position[1], position[2]).addScaledVector(tmpN, 0.004);
    slot.size = size;
    slot.permanent = permanent;
    slot.bornAt = time;
    slot.life = life;
    slot.fade = FADE_SECONDS;
    slot.active = true;
    this.place(index, permanent ? 1 : growCurve(0));
    this.mesh.setColorAt(index, color);
    this.cellAttr.setX(index, variant % (CELLS * CELLS));
    this.opacityAttr.setX(index, 1);
    this.mesh.count = Math.max(this.mesh.count, index + 1);
    this.markDirty();
    return index;
  }

  /** Grows fresh splats and fades out expired ones. Cheap: touches only active dynamic slots. */
  update(time: number): void {
    let faded = false;
    let moved = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const s = this.slots[i] as DecalSlot;
      if (!s.active || s.permanent) continue;
      const age = time - s.bornAt;
      if (age < GROW_SECONDS + 0.05) {
        this.place(i, growCurve(age / GROW_SECONDS));
        moved = true;
      }
      if (age < s.life) continue;
      const o = 1 - (age - s.life) / s.fade;
      this.opacityAttr.setX(i, Math.max(0, o));
      faded = true;
      if (o <= 0) {
        this.retire(i);
        moved = true;
      }
    }
    // Trailing free slots are not drawn at all.
    while (this.mesh.count > 0 && !(this.slots[this.mesh.count - 1] as DecalSlot).active)
      this.mesh.count--;
    if (faded) this.opacityAttr.needsUpdate = true;
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Mops every dynamic decal away: they fade quickly, in a wave spreading out from `origin`
   * (where the mop starts), or all at once without one.
   */
  sweep(time: number, origin: { x: number; y: number; z: number } | null = null): void {
    for (let i = 0; i < this.mesh.count; i++) {
      const s = this.slots[i] as DecalSlot;
      if (!s.active || s.permanent) continue;
      const age = Math.max(0, time - s.bornAt);
      if (age > s.life) {
        // Already fading: finish faster, continuing from the current opacity.
        const o = Math.max(0, 1 - (age - s.life) / s.fade);
        s.life = age - (1 - o) * SWEEP_FADE;
      } else {
        const d = origin ? s.position.distanceTo(tmpS.set(origin.x, origin.y, origin.z)) : 0;
        s.life = Math.min(s.life, age + Math.min(SWEEP_MAX_DELAY, d / SWEEP_SPEED));
      }
      s.fade = SWEEP_FADE;
    }
  }

  /** Removes all dynamic decals at once (room change, tests). */
  clearDynamic(): void {
    for (let i = 0; i < this.mesh.count; i++) {
      const s = this.slots[i] as DecalSlot;
      if (s.active && !s.permanent) this.retire(i);
    }
    this.markDirty();
  }

  /** Dynamic decals on screen, fading ones included. */
  get activeDynamic(): number {
    let n = 0;
    for (let i = 0; i < this.mesh.count; i++) {
      const s = this.slots[i] as DecalSlot;
      if (s.active && !s.permanent) n++;
    }
    return n;
  }

  /** Dynamic decals not yet fading (what the budget limits). */
  liveDynamic(time: number): number {
    let n = 0;
    for (let i = 0; i < this.mesh.count; i++) {
      const s = this.slots[i] as DecalSlot;
      if (s.active && !s.permanent && time - s.bornAt < s.life) n++;
    }
    return n;
  }

  get permanentCount(): number {
    let n = 0;
    for (let i = 0; i < this.mesh.count; i++) if ((this.slots[i] as DecalSlot).permanent) n++;
    return n;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }

  /** Enforces the budget by expiring the oldest dynamic decals first. */
  enforceBudget(time: number): void {
    const active: { i: number; bornAt: number }[] = [];
    for (let i = 0; i < this.mesh.count; i++) {
      const s = this.slots[i] as DecalSlot;
      if (s.active && !s.permanent && time - s.bornAt < s.life)
        active.push({ i, bornAt: s.bornAt });
    }
    if (active.length <= this.budget) return;
    active.sort((a, b) => a.bornAt - b.bornAt);
    for (let k = 0; k < active.length - this.budget; k++) {
      const s = this.slots[(active[k] as { i: number }).i] as DecalSlot;
      s.life = Math.max(0, time - s.bornAt);
    }
  }

  private allocate(permanent: boolean): number {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i] as DecalSlot;
      if (!s.active) return i;
    }
    if (permanent) throw new Error('Decal capacity exhausted by permanent decals');
    // Over capacity: recycle the oldest dynamic decal.
    let oldest = -1;
    let bornAt = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i] as DecalSlot;
      if (!s.permanent && s.bornAt < bornAt) {
        bornAt = s.bornAt;
        oldest = i;
      }
    }
    this.cursor = (this.cursor + 1) % this.capacity;
    return oldest >= 0 ? oldest : this.cursor;
  }

  private place(index: number, grow: number): void {
    const s = this.slots[index] as DecalSlot;
    tmpS.set(s.size * grow, s.size * grow, 1);
    tmpM.compose(s.position, tmpQ.copy(s.rotation), tmpS);
    this.mesh.setMatrixAt(index, tmpM);
  }

  /** Frees a slot; a zero matrix keeps it from costing any fill rate meanwhile. */
  private retire(index: number): void {
    const s = this.slots[index] as DecalSlot;
    s.active = false;
    this.opacityAttr.setX(index, 0);
    this.mesh.setMatrixAt(index, ZERO);
  }

  private markDirty(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.cellAttr.needsUpdate = true;
    this.opacityAttr.needsUpdate = true;
  }
}

/**
 * Fragment snippet turning the splat atlas (`uniform sampler2D uSplats`) at `vec2 atlasUv` into
 * ink with crisp edges; leaves `splat` (r: edge field, g: wet sheen) for later chunks.
 */
export const SPLAT_INK_GLSL = [
  'vec4 splat = texture2D(uSplats, atlasUv);',
  'float fw = max(fwidth(splat.r), 0.002);',
  'float inkMask = smoothstep(0.5 - fw, 0.5 + fw, splat.r);',
  'diffuseColor.a *= inkMask;',
  'diffuseColor.rgb *= 0.92 + splat.g * 0.16;',
].join('\n');

/** Atlas coordinate of `(u, v)` (0..1) inside splat shape `cell` (0..15). */
export function splatAtlasUv(u: number, v: number, cell: number): [number, number] {
  const c = ((cell % (CELLS * CELLS)) + CELLS * CELLS) % (CELLS * CELLS);
  return [
    (u * 0.98 + 0.01 + (c % CELLS)) / CELLS,
    (v * 0.98 + 0.01 + Math.floor(c / CELLS)) / CELLS,
  ];
}
