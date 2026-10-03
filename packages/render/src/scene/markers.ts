import type { WorldView } from '@huddle/engine';
import type { ResolvedRoom } from '@huddle/shared';
import * as THREE from 'three';

/**
 * Marker colors stay close to 1.0 so AgX tone mapping keeps them saturated (brighter values wash
 * out towards pastel and disappear against the colorful room).
 */
function neonMaterial(hex: string, intensity: number, onTop = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(hex).multiplyScalar(intensity),
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    depthTest: !onTop,
  });
}

/**
 * Hover and navigation feedback: a floating chevron + halo ring over the hovered seat or
 * interactable, and a pulsing ring at the click-to-move destination.
 */
export class Markers {
  readonly group = new THREE.Group();
  /** Objects that should glow (selective bloom). */
  readonly bloom: THREE.Object3D[];
  private readonly chevron: THREE.Mesh;
  private readonly outline: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly target: THREE.Mesh;
  private readonly room: ResolvedRoom;
  private readonly seatPos = new Map<string, THREE.Vector3>();
  private readonly itemPos = new Map<string, THREE.Vector3>();
  private readonly moving = new THREE.Vector3();
  private visibleHover = 0;

  constructor(room: ResolvedRoom) {
    this.room = room;
    this.group.name = 'markers';
    const chevronGeo = new THREE.ConeGeometry(0.13, 0.26, 4, 1);
    chevronGeo.rotateX(Math.PI);
    this.chevron = new THREE.Mesh(chevronGeo, neonMaterial('#B6FF2E', 1.15));
    // Dark back-face shell = outline, so the chevron reads against busy, bright backgrounds.
    const outlineMat = new THREE.MeshBasicMaterial({
      color: '#1B1B2F',
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    this.outline = new THREE.Mesh(chevronGeo, outlineMat);
    this.outline.scale.setScalar(1.28);
    this.chevron.add(this.outline);
    // The halo is drawn on top: seat cushions would otherwise swallow it.
    this.halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.022, 8, 48),
      neonMaterial('#B6FF2E', 1.1, true),
    );
    this.halo.rotation.x = Math.PI / 2;
    this.target = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 40),
      neonMaterial('#00D9C0', 1.2),
    );
    this.target.rotation.x = -Math.PI / 2;
    for (const m of [this.chevron, this.halo, this.target]) {
      m.visible = false;
      m.renderOrder = 8;
      this.group.add(m);
    }
    this.outline.renderOrder = 7;
    this.bloom = [this.chevron, this.halo, this.target];
    for (const s of room.seats) this.seatPos.set(s.id, new THREE.Vector3(...s.position));
    for (const i of room.interactables) this.itemPos.set(i.id, new THREE.Vector3(...i.position));
  }

  update(view: WorldView, time: number, dt: number): void {
    const h = view.hover;
    let anchor: THREE.Vector3 | undefined;
    if (h.kind === 'seat' && h.id) anchor = this.seatPos.get(h.id);
    else if (h.kind === 'interactable' && h.id) {
      // Things that move (a landed paper plane) carry their own position.
      anchor = h.anchor
        ? this.moving.set(h.anchor.x, h.anchor.y, h.anchor.z)
        : this.itemPos.get(h.id);
    }
    this.visibleHover += ((anchor ? 1 : 0) - this.visibleHover) * Math.min(1, dt * 14);
    const show = this.visibleHover > 0.02 && anchor !== undefined;
    this.chevron.visible = show;
    this.halo.visible = show && h.kind === 'seat';
    if (show && anchor) {
      const bob = Math.sin(time * 4) * 0.05;
      const s = 0.6 + this.visibleHover * 0.4;
      this.chevron.position.set(anchor.x, anchor.y + 1.05 + bob, anchor.z);
      this.chevron.rotation.y = time * 1.6;
      this.chevron.scale.setScalar(s);
      this.halo.position.set(anchor.x, anchor.y + 0.05, anchor.z);
      this.halo.scale.setScalar(s * (1 + Math.sin(time * 5) * 0.04));
    }
    const pt = view.pathTarget;
    this.target.visible = pt !== null;
    if (pt) {
      const pulse = 1 + Math.sin(time * 6) * 0.12;
      this.target.position.set(pt.x, pt.y + 0.02, pt.z);
      this.target.scale.setScalar(pulse);
    }
  }

  get roomId(): string {
    return this.room.data.id;
  }

  dispose(): void {
    for (const m of [this.chevron, this.halo, this.target]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    (this.outline.material as THREE.Material).dispose();
  }
}
