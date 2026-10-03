import type { ActionName, AvatarSpec, InputBindings } from '@huddle/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  INITIAL_VOICE,
  type MicProcessingUi,
  type PresenterUi,
  type PresentRequestUi,
  type ShareHintUi,
  type VoiceModeUi,
  type VoiceUi,
} from './store-media.ts';
import { INITIAL_PLAY, type PlayUi } from './store-play.ts';

export type Phase = 'loading' | 'ready' | 'error' | 'unsupported';
export type QualityChoiceUi = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type LookUi = 'agx' | 'aces' | 'neutral';
export type PanelUi = 'chat' | 'people' | 'help' | null;
/** Small menus anchored to the control bar (play, react) or the top-right cluster (more). */
export type PopoverUi = 'play' | 'react' | 'more' | null;
export type BoardToolUi = 'pen' | 'marker' | 'eraser';

export interface DebugStats {
  fps: number;
  frameMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  heapMb: number | null;
  resolution: string;
  quality: string;
  gpu: string;
  decals: number;
  camera: string;
  /** Network/RTC stats; null while offline. */
  pingMs: number | null;
  packetLoss: number | null;
  bitrateKbps: number | null;
  peers: { id: string; state: string }[];
  audio: { id: string; level: number }[];
}

export interface Toast {
  id: number;
  textKey: string;
  tone: 'info' | 'warn' | 'error';
  vars?: Readonly<Record<string, string | number>>;
}

/** Connection to the realtime server. `offline` = playing alone (or with AI office-mates). */
export type NetStateUi = 'offline' | 'connecting' | 'joined' | 'reconnecting' | 'failed';

/** The online room as the top bar and host menu show it (null offline). */
export interface RoomUi {
  code: string;
  mode: 'serious' | 'casual' | 'party';
  voice: VoiceModeUi;
  throwsLocked: boolean;
  /** Passcode protected. */
  locked: boolean;
  isHost: boolean;
  capacity: number;
}

/**
 * Before the room: `start` is the landing (new room, or a code to join); `ready` is the green
 * room, where you see yourself in the room, set your name and check the microphone.
 */
export type LobbyStepUi = 'start' | 'ready';

/** The join screen: shown after loading until you join a room or choose to play offline. */
export interface LobbyUi {
  step: LobbyStepUi;
  /** Room code to join; '' creates a new room. */
  room: string;
  name: string;
  /** The room asked for a passcode (or the last one was wrong). */
  needsPasscode: boolean;
  busy: boolean;
  /** i18n key of the last problem, or null. */
  error: string | null;
}

/** Someone in the room, as the people panel and hand queue show them. */
export interface PersonUi {
  id: string;
  name: string;
  isLocal: boolean;
  isBot: boolean;
  /** Connection dropped; they may come back within the grace window. */
  away: boolean;
  isHost: boolean;
  /** Microphone muted (or no voice at all). */
  muted: boolean;
  speaking: boolean;
  /** Your playback volume for this person, 0..2. */
  volume: number;
  seated: boolean;
  handRaised: boolean;
  /** 1-based place in the raised-hand queue. */
  handOrder: number | null;
  color: string;
  /** Basketball points in this room. */
  points: number;
  /** "Don't hit me" is on. */
  shield: boolean;
}

export interface ChatMessageUi {
  id: number;
  playerId: string | null;
  name: string;
  text: string;
  kind: 'chat' | 'system';
  color: string;
}

/** Opaque avatar preview driven by the app (a small separate WebGL view). */
export interface AvatarPreviewHandle {
  setSpec(spec: AvatarSpec): void;
  drag(deltaX: number): void;
  setFraming(target: number): void;
  play(actionId: string): void;
  dispose(): void;
}

/** Swatch colors for the avatar editor (hex). */
export interface AvatarPaletteUi {
  skin: readonly string[];
  hair: readonly string[];
  cloth: readonly string[];
  eye: readonly string[];
}

export interface HudState {
  phase: Phase;
  loadingKey: string;
  loadingProgress: number;
  errorMessage: string | null;
  locale: string;
  roomName: string;
  prompt: { kind: string; labelKey: string } | null;
  seated: boolean;
  cameraMode: string;
  hoverScreen: boolean;
  debugOpen: boolean;
  settingsOpen: boolean;
  debug: DebugStats;
  quality: QualityChoiceUi;
  look: LookUi;
  reducedMotion: boolean;
  sfxVolume: number;
  bindings: InputBindings;
  toasts: Toast[];
  contextLost: boolean;
  touch: boolean;
  people: PersonUi[];
  chat: ChatMessageUi[];
  unread: number;
  panel: PanelUi;
  popover: PopoverUi;
  /** True while a text field has focus (gameplay keys are off). */
  typing: boolean;
  /** Bumped to focus the chat input (the chat key). */
  chatFocus: number;
  emoteWheel: boolean;
  /** Throwable being aimed, or null. */
  aim: string | null;
  handRaised: boolean;
  lightScene: string;
  sharing: boolean;
  shareSupported: boolean;
  /** Theater Mode: the crisp DOM video of whatever is on the big screen. */
  theater: HTMLVideoElement | null;
  board: { id: string; tool: BoardToolUi; color: string } | null;
  avatarOpen: boolean;
  avatarSpec: AvatarSpec | null;
  avatarPalette: AvatarPaletteUi;
  playerName: string;
  lobby: LobbyUi | null;
  net: NetStateUi;
  room: RoomUi | null;
  voice: VoiceUi;
  presenter: PresenterUi | null;
  presentRequests: PresentRequestUi[];
  shareHint: ShareHintUi;
  /** Playback volume of the presenter's screen audio (0..2), null when it has none. */
  screenVolume: number | null;
  /** The page is in browser fullscreen. */
  fullscreen: boolean;
  play: PlayUi;
  /** Room tone and footsteps, 0..1. */
  ambienceVolume: number;
}

export type HudStore = StoreApi<HudState>;

export const EMPTY_DEBUG: DebugStats = {
  fps: 0,
  frameMs: 0,
  renderMs: 0,
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
  heapMb: null,
  resolution: '',
  quality: '',
  gpu: '',
  decals: 0,
  camera: '',
  pingMs: null,
  packetLoss: null,
  bitrateKbps: null,
  peers: [],
  audio: [],
};

/**
 * HUD view state. The game loop (outside React) writes into it; React components only read it
 * and call `HudCommands`. No game logic lives in the UI.
 */
export function createHudStore(
  initial: Pick<HudState, 'locale' | 'bindings' | 'touch'> & Partial<HudState>,
): HudStore {
  return createStore<HudState>(() => ({
    phase: 'loading',
    loadingKey: 'app.loading',
    loadingProgress: 0,
    errorMessage: null,
    roomName: '',
    prompt: null,
    seated: false,
    cameraMode: 'follow',
    hoverScreen: false,
    debugOpen: false,
    settingsOpen: false,
    debug: EMPTY_DEBUG,
    quality: 'auto',
    look: 'agx',
    reducedMotion: false,
    sfxVolume: 0.7,
    toasts: [],
    contextLost: false,
    people: [],
    chat: [],
    unread: 0,
    panel: null,
    popover: null,
    typing: false,
    chatFocus: 0,
    emoteWheel: false,
    aim: null,
    handRaised: false,
    lightScene: 'meeting',
    sharing: false,
    shareSupported: false,
    theater: null,
    board: null,
    avatarOpen: false,
    avatarSpec: null,
    avatarPalette: { skin: [], hair: [], cloth: [], eye: [] },
    playerName: '',
    lobby: null,
    net: 'offline',
    room: null,
    voice: INITIAL_VOICE,
    presenter: null,
    presentRequests: [],
    shareHint: 'detail',
    screenVolume: null,
    fullscreen: false,
    play: INITIAL_PLAY,
    ambienceVolume: 0.5,
    ...initial,
  }));
}

let toastSeq = 1;

export function pushToast(
  store: HudStore,
  textKey: string,
  tone: Toast['tone'] = 'info',
  vars?: Toast['vars'],
): void {
  const toast: Toast = { id: toastSeq++, textKey, tone, ...(vars ? { vars } : {}) };
  store.setState((s) => ({ toasts: [...s.toasts.slice(-3), toast] }));
}

export function dismissToast(store: HudStore, id: number): void {
  store.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

const CHAT_HISTORY = 80;
let chatSeq = 1;

/** Appends a chat line (history is capped); counts unread while the chat panel is closed. */
export function pushChat(store: HudStore, message: Omit<ChatMessageUi, 'id'>): void {
  const m: ChatMessageUi = { ...message, id: chatSeq++ };
  store.setState((s) => ({
    chat: [...s.chat.slice(-(CHAT_HISTORY - 1)), m],
    unread: s.panel === 'chat' || message.kind === 'system' ? s.unread : s.unread + 1,
  }));
}

/** Commands the HUD can issue; implemented by the app composition root. */
export interface HudCommands {
  setQuality(choice: QualityChoiceUi): void;
  setLook(look: LookUi): void;
  setReducedMotion(on: boolean): void;
  setSfxVolume(volume: number): void;
  setLocale(locale: string): void;
  setDebugOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  focusScreen(): void;
  pressAction(action: ActionName, pressed: boolean): void;
  captureKey(): Promise<string>;
  setBinding(action: ActionName, codes: readonly string[]): void;
  resetBindings(): void;
  retry(): void;
  setPanel(panel: PanelUi): void;
  setPopover(popover: PopoverUi): void;
  setTyping(typing: boolean): void;
  sendChat(text: string): void;
  setEmoteWheel(open: boolean): void;
  emote(actionId: string): void;
  react(emoji: string): void;
  raiseHand(): void;
  setAim(kind: string | null): void;
  /** Throws something at a person (people panel). */
  throwAt(playerId: string, kind: string): void;
  cycleCamera(): void;
  recenterCamera(): void;
  setCameraMode(mode: 'follow' | 'overview' | 'free'): void;
  setLightScene(scene: string): void;
  toggleShare(): void;
  openTheater(): void;
  closeTheater(): void;
  /** Theater Mode: the presenter's screen audio, 0..2. */
  setScreenVolume(volume: number): void;
  /** Browser fullscreen (on iPhone, the video's own fullscreen player). */
  toggleFullscreen(): void;
  openBoard(): void;
  closeBoard(): void;
  setBoardTool(tool: BoardToolUi, color?: string): void;
  clearBoard(): void;
  clearMess(): void;
  setAvatarOpen(open: boolean): void;
  mountAvatarPreview(canvas: HTMLCanvasElement): AvatarPreviewHandle;
  saveAvatar(spec: AvatarSpec, name: string): void;
  randomAvatar(): AvatarSpec;
  /**
   * Lobby: from the landing into the green room for `room` ('' = a new room; a malformed code
   * stays on the landing with an error), or back to the landing.
   */
  setLobbyStep(step: LobbyStepUi, room?: string): void;
  /** Green room: the name tag over your avatar follows the name field while you type. */
  previewName(name: string): void;
  /**
   * Green room: the fractions of the screen the panel covers (on the left, at the bottom), so
   * the camera frames your avatar in the rest.
   */
  setLobbyInsets(left: number, bottom: number): void;
  /** Joins a room by code ('' creates a fresh one). */
  joinRoom(room: string, name: string, passcode: string): void;
  /** Skips the server: alone in the room with AI office-mates. */
  playOffline(): void;
  /** Leaves the online room and returns to the lobby. */
  leaveRoom(): void;
  copyInvite(): void;
  /** Host only. */
  setRoomMode(mode: RoomUi['mode']): void;
  lockThrows(locked: boolean): void;
  kick(playerId: string): void;
  lowerHand(playerId: string): void;
  makeHost(playerId: string): void;
  setVoiceMode(mode: VoiceModeUi): void;
  muteAll(): void;
  stopShare(): void;
  /** Voice. */
  toggleMute(): void;
  toggleDeafen(): void;
  /** Asks for the microphone (the browser prompt). */
  enableMic(): void;
  /** "Hear yourself": records a few seconds and plays them back (again: cancels). */
  testEcho(): void;
  setMicDevice(id: string | null): void;
  setOutputDevice(id: string): void;
  setMicProcessing(p: MicProcessingUi): void;
  setPersonVolume(playerId: string, volume: number): void;
  /** Sharing. */
  setShareHint(hint: ShareHintUi): void;
  answerPresentRequest(playerId: string, accept: boolean): void;
  /** Playful layer: hold something (null puts it away), use it, "Don't hit me", plane tilt. */
  holdItem(item: string | null): void;
  useItem(): void;
  setShield(on: boolean): void;
  tiltPlane(delta: number): void;
  setAmbienceVolume(volume: number): void;
  /** Host only: every basketball score back to zero. */
  resetScores(): void;
}

export type Translate = (key: string, vars?: Readonly<Record<string, string | number>>) => string;
