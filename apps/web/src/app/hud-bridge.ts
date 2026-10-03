import type { PlayerView, Simulation, WorldView } from '@huddle/engine';
import type { GameRenderer } from '@huddle/render';
import type { InputFrame } from '@huddle/shared';
import type { HudStore, PersonUi, WorldLabels } from '@huddle/ui';
import { accentFor } from './accents.ts';

type PerfWithMemory = Performance & { memory?: { usedJSHeapSize: number } };

/** What the people panel shows beyond the simulation (`version` bumps when it changes). */
export interface Presence {
  readonly version: number;
  isAway(playerId: string): boolean;
  isHost(playerId: string): boolean;
  isMuted(playerId: string): boolean;
  isSpeaking(playerId: string): boolean;
  /** Live voice level 0..1 (drives the speaking badge on name tags). */
  levelOf(playerId: string): number;
  /** Your playback volume for this person, 0..2. */
  volumeOf(playerId: string): number;
  /** Basketball points in this room. */
  pointsOf(playerId: string): number;
}

/** Extra height over the avatar's head anchor (which already clears the hair). */
const LABEL_LIFT = 0;

/** Cheap fingerprint of what the people panel shows (names, seats, hands, protection). */
function peopleSignature(view: WorldView): number {
  let sig = view.playersVersion * 7919;
  for (const p of view.players)
    sig =
      (sig * 31 +
        (p.seatId ? 1 : 0) +
        (p.handRaised ? 2 : 0) +
        (p.shield ? 4 : 0) +
        Math.round(p.handRaisedAt * 10)) |
      0;
  return sig;
}

/**
 * Pushes game state into the HUD store without flooding React (values are diffed every frame,
 * debug stats sampled at 4 Hz while visible) and positions the DOM name tags every frame.
 */
export class HudBridge {
  private readonly store: HudStore;
  private readonly uiRoot: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly labels: WorldLabels;
  private lastPromptKey = '';
  private lastSeated = false;
  private lastMode = '';
  private lastHover = false;
  private lastAim: string | null = null;
  private lastHand = false;
  private lastCursor = '';
  private lastPeople = Number.NaN;
  private labelsVersion = -1;
  /** Your own tag is shown in full (green room). */
  private previewTag = false;
  private readonly hands = new Map<string, boolean>();
  private readonly shields = new Map<string, boolean>();
  private debugTimer = 0;
  private readonly projected = { x: 0, y: 0, depth: 0 };
  private readonly anchor = { x: 0, y: 0, z: 0 };

  constructor(
    store: HudStore,
    uiRoot: HTMLElement,
    canvas: HTMLCanvasElement,
    labels: WorldLabels,
  ) {
    this.store = store;
    this.uiRoot = uiRoot;
    this.canvas = canvas;
    this.labels = labels;
  }

  sync(
    sim: Simulation,
    renderer: GameRenderer,
    dt: number,
    input: Pick<InputFrame, 'pointerX' | 'pointerY' | 'pointerActive'>,
    boardMode: boolean,
    presence: Presence,
  ): void {
    const view = sim.view;
    const prompt = view.prompt;
    const promptKey = prompt ? `${prompt.kind}:${prompt.labelKey}` : '';
    const seated = (view.localPlayer?.seatId ?? null) !== null;
    const mode = view.camera.mode;
    const hoverScreen = view.hover.kind === 'screen' && sim.localControl;
    const aim = sim.aim;
    const hand = view.localPlayer?.handRaised ?? false;
    if (
      promptKey !== this.lastPromptKey ||
      seated !== this.lastSeated ||
      mode !== this.lastMode ||
      hoverScreen !== this.lastHover ||
      aim !== this.lastAim ||
      hand !== this.lastHand
    ) {
      this.lastPromptKey = promptKey;
      this.lastSeated = seated;
      this.lastMode = mode;
      this.lastHover = hoverScreen;
      this.lastAim = aim;
      this.lastHand = hand;
      this.store.setState({
        prompt: prompt ? { kind: prompt.kind, labelKey: prompt.labelKey } : null,
        seated,
        cameraMode: mode,
        hoverScreen,
        aim,
        handRaised: hand,
      });
    }
    this.syncPeople(view, presence);
    this.syncLabels(view);
    this.syncCursor(sim, boardMode);
    if (hoverScreen && input.pointerActive) {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((input.pointerX + 1) / 2) * rect.width;
      const y = ((1 - input.pointerY) / 2) * rect.height;
      this.uiRoot.style.setProperty('--pointer-x', `${x}px`);
      this.uiRoot.style.setProperty('--pointer-y', `${y}px`);
    }
    this.debugTimer -= dt;
    if (this.debugTimer <= 0 && this.store.getState().debugOpen) {
      this.debugTimer = 0.25;
      this.syncDebug(renderer, mode);
    }
  }

  /** Name tags follow the heads; call after rendering so they match the drawn frame. */
  placeLabels(view: WorldView, renderer: GameRenderer, presence: Presence): void {
    const out = this.projected;
    for (const p of view.players) {
      const head = renderer.avatars.anchorOf(p.id);
      const a = this.anchor;
      if (head) {
        a.x = head.x;
        a.y = head.y + LABEL_LIFT;
        a.z = head.z;
      } else {
        a.x = p.position.x;
        a.y = p.position.y + 1.95;
        a.z = p.position.z;
      }
      const onScreen = renderer.project(a, out);
      this.labels.place(p.id, out.x, out.y, out.depth, onScreen && out.depth > 0.8);
      this.labels.level(p.id, presence.levelOf(p.id));
    }
  }

  private syncPeople(view: WorldView, presence: Presence): void {
    const sig = (peopleSignature(view) * 31 + presence.version) | 0;
    if (sig === this.lastPeople) return;
    this.lastPeople = sig;
    const queue = new Map(
      view.players
        .filter((p) => p.handRaised)
        .sort((a, b) => a.handRaisedAt - b.handRaisedAt)
        .map((p, i) => [p.id, i + 1]),
    );
    const people: PersonUi[] = view.players.map((p: PlayerView) => ({
      id: p.id,
      name: p.name,
      isLocal: p.isLocal,
      isBot: p.isBot,
      away: presence.isAway(p.id),
      isHost: presence.isHost(p.id),
      muted: presence.isMuted(p.id),
      speaking: presence.isSpeaking(p.id),
      volume: presence.volumeOf(p.id),
      seated: p.seatId !== null,
      handRaised: p.handRaised,
      handOrder: queue.get(p.id) ?? null,
      color: accentFor(p.id),
      points: presence.pointsOf(p.id),
      shield: p.shield,
    }));
    // You first, then the hand queue, then everyone else by name.
    people.sort(
      (a, b) =>
        Number(b.isLocal) - Number(a.isLocal) ||
        (a.handOrder ?? 99) - (b.handOrder ?? 99) ||
        a.name.localeCompare(b.name),
    );
    this.store.setState({ people });
  }

  private syncLabels(view: WorldView): void {
    if (view.playersVersion !== this.labelsVersion) {
      this.labelsVersion = view.playersVersion;
      const ids = new Set<string>();
      for (const p of view.players) {
        ids.add(p.id);
        this.labels.upsert(p.id, {
          name: p.name,
          isLocal: p.isLocal,
          isBot: p.isBot,
          color: accentFor(p.id),
        });
      }
      for (const id of [...this.hands.keys()]) {
        if (ids.has(id)) continue;
        this.labels.remove(id);
        this.hands.delete(id);
        this.shields.delete(id);
      }
    }
    const self = view.localPlayer?.id;
    const preview = this.store.getState().lobby?.step === 'ready';
    if (self !== undefined && preview !== this.previewTag) {
      this.previewTag = preview;
      this.labels.preview(self, preview);
    }
    for (const p of view.players) {
      if (this.hands.get(p.id) !== p.handRaised) {
        this.hands.set(p.id, p.handRaised);
        this.labels.hand(p.id, p.handRaised);
      }
      if (this.shields.get(p.id) !== p.shield) {
        this.shields.set(p.id, p.shield);
        this.labels.shield(p.id, p.shield);
      }
    }
  }

  private syncCursor(sim: Simulation, boardMode: boolean): void {
    const kind = sim.view.hover.kind;
    let cursor = 'default';
    if (boardMode) cursor = kind === 'board' ? 'crosshair' : 'default';
    else if (sim.aim) cursor = 'crosshair';
    else if (
      kind === 'seat' ||
      kind === 'screen' ||
      kind === 'interactable' ||
      kind === 'board' ||
      kind === 'player'
    )
      cursor = 'pointer';
    if (cursor === this.lastCursor) return;
    this.lastCursor = cursor;
    this.canvas.style.cursor = cursor;
  }

  private syncDebug(renderer: GameRenderer, mode: string): void {
    const s = renderer.stats;
    const mem = (performance as PerfWithMemory).memory;
    const prev = this.store.getState().debug;
    this.store.setState({
      debug: {
        ...prev,
        fps: s.fps,
        frameMs: s.frameMs,
        renderMs: s.renderMs,
        drawCalls: s.drawCalls,
        triangles: s.triangles,
        geometries: s.geometries,
        textures: s.textures,
        programs: s.programs,
        heapMb: mem ? mem.usedJSHeapSize / 1048576 : null,
        resolution: `${Math.round(s.width * s.pixelRatio)}×${Math.round(s.height * s.pixelRatio)} (${Math.round(s.resolutionScale * 100)}%)`,
        quality: `${s.quality}${s.qualityChoice === 'auto' ? ' (auto)' : ''}`,
        gpu: s.gpu,
        decals: s.decals,
        camera: mode,
      },
    });
  }
}
