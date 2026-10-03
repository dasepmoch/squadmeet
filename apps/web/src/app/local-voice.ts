import type { PlatformServices } from '@huddle/platform';
import { LocalMic, type MicProcessing, type MicState } from '@huddle/rtc';
import { errorMessage, type Logger, type Unsubscribe } from '@huddle/shared';
import {
  ECHO_TEST_MS,
  INITIAL_VOICE,
  pushToast,
  type DeviceUi,
  type HudStore,
  type VoiceUi,
} from '@huddle/ui';

/** Saved voice preferences (part of `UserSettings`). */
export interface VoicePrefs {
  micDevice: string | null;
  speakerDevice: string | null;
  micProcessing: MicProcessing;
}

export interface LocalVoiceDeps {
  platform: PlatformServices;
  store: HudStore;
  log: Logger;
  prefs: () => VoicePrefs;
  persist: (patch: Partial<VoicePrefs>) => void;
  /** Mute, deafen, push-to-talk or the microphone itself changed (tell the room). */
  onChange: () => void;
}

/** Mic test meter refresh rate while the lobby or settings show it (lively, still cheap). */
const METER_HZ = 20;
/** Speaking into a muted microphone this long shows the "you are muted" hint... */
const MUTED_HINT_AFTER = 0.7;
/** ...which stays until this much quiet. */
const MUTED_HINT_HOLD = 2.5;

const FAILURE_TOASTS: Partial<Record<MicState, string>> = {
  denied: 'voice.denied',
  unavailable: 'voice.noMic',
  failed: 'voice.failed',
};

/**
 * Your own voice: the microphone (permission, device, processing), mute, deafen and
 * push-to-talk, and the HUD's view of it (mic test meter, device lists, "you are muted" hint).
 * Joining starts muted; deafening also mutes, and unmuting brings the room back.
 */
export class LocalVoice {
  readonly mic: LocalMic;
  muted = true;
  deafened = false;
  private pushed = false;
  private readonly d: LocalVoiceDeps;
  private ui: VoiceUi;
  private meterTimer = 0;
  private mutedTalk = 0;
  private mutedQuiet = 0;
  private devicesSeq = 0;
  /** The green room is open: your avatar and tag show your mic test (nobody hears it). */
  private previewing = false;
  private echoAbort: AbortController | null = null;

  constructor(deps: LocalVoiceDeps) {
    this.d = deps;
    this.mic = new LocalMic(deps.platform.mediaDevices, deps.platform.audio, deps.log);
    const prefs = deps.prefs();
    this.mic.deviceId = prefs.micDevice;
    this.mic.processing = { ...prefs.micProcessing };
    this.ui = {
      ...INITIAL_VOICE,
      ...prefs.micProcessing,
      inputId: prefs.micDevice,
      outputId: prefs.speakerDevice,
      outputSupported: deps.platform.capabilities.audioOutputSelection,
      echoSupported: deps.platform.recorder.supported,
    };
    deps.store.setState({ voice: this.ui });
  }

  attach(): Unsubscribe[] {
    return [
      this.mic.events.on('state', (e) => {
        this.sync();
        this.d.onChange();
        if (e.state === 'live') void this.refreshDevices();
      }),
      this.d.platform.mediaDevices.onDeviceChange(() => void this.refreshDevices()),
    ];
  }

  /** Others hear you right now (live and unmuted, or push-to-talk held). */
  get transmitting(): boolean {
    return this.mic.transmitting;
  }

  get speaking(): boolean {
    return this.mic.transmitting && this.mic.detector.speaking;
  }

  /** Smoothed voice level while others hear you (the mouth flap), else 0. */
  get talkLevel(): number {
    return this.mic.transmitting ? this.mic.detector.level : 0;
  }

  /** Green room: your avatar's mouth follows the mic test, muted or not. */
  get previewLevel(): number {
    return this.previewing && this.mic.state === 'live' ? this.mic.detector.level : 0;
  }

  get previewSpeaking(): boolean {
    return this.previewing && this.mic.state === 'live' && this.mic.detector.speaking;
  }

  /**
   * On the Join click (a user gesture): audio may start now, the saved speaker applies, and a
   * microphone the browser already allows starts (muted) so unmuting is instant.
   */
  async prepare(): Promise<void> {
    const { audio, permissions } = this.d.platform;
    await audio.resume().catch(() => undefined);
    const speaker = this.d.prefs().speakerDevice;
    if (speaker) await this.applySpeaker(speaker);
    if (this.mic.state !== 'off') return;
    const permission = await permissions.query('microphone').catch(() => 'unknown');
    if (permission === 'granted') await this.enable(false);
  }

  /** Asks for the microphone (the browser prompt the first time); optionally unmutes. */
  async enable(unmute: boolean): Promise<void> {
    void this.d.platform.audio.resume().catch(() => undefined);
    const state = this.mic.state === 'live' ? 'live' : await this.mic.start();
    if (state === 'live') {
      if (unmute) this.setMuted(false);
      return;
    }
    const key = FAILURE_TOASTS[state];
    if (key) pushToast(this.d.store, key, 'warn');
  }

  toggleMute(): void {
    if (this.mic.state !== 'live') void this.enable(true);
    else this.setMuted(!this.muted);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // Talking again brings the room back too (like most voice apps).
    if (!muted) this.deafened = false;
    this.apply();
  }

  toggleDeafen(): void {
    this.deafened = !this.deafened;
    this.apply();
  }

  setPushToTalk(down: boolean): void {
    if (down === this.pushed) return;
    if (down && this.mic.state === 'off') void this.enable(false);
    this.pushed = down;
    this.apply();
  }

  /**
   * "Hear yourself": records a few seconds of the microphone (muted or not, nobody else hears
   * it) and plays them back on the speaker. Calling it again cancels.
   */
  async echoTest(): Promise<void> {
    if (this.echoAbort) {
      this.cancelEcho();
      return;
    }
    const { recorder } = this.d.platform;
    if (!recorder.supported) return;
    const abort = new AbortController();
    this.echoAbort = abort;
    try {
      if (this.mic.state !== 'live') await this.enable(false);
      const stream = this.mic.monitorStream;
      if (abort.signal.aborted || this.mic.state !== 'live' || !stream) return;
      this.patchUi({ echo: 'recording' });
      const clip = await recorder.record(stream, ECHO_TEST_MS, abort.signal);
      if (abort.signal.aborted || clip.size === 0) return;
      this.patchUi({ echo: 'playing' });
      await this.playClip(clip, abort.signal);
    } catch (err: unknown) {
      if (!abort.signal.aborted) {
        this.d.log.warn('echo test failed', errorMessage(err));
        pushToast(this.d.store, 'voice.echoFailed', 'warn');
      }
    } finally {
      // A cancelled test already reset (and maybe a new one started meanwhile).
      if (this.echoAbort === abort) {
        this.echoAbort = null;
        this.patchUi({ echo: 'idle' });
      }
    }
  }

  private cancelEcho(): void {
    this.echoAbort?.abort();
    this.echoAbort = null;
    this.patchUi({ echo: 'idle' });
  }

  async setDevice(id: string | null): Promise<void> {
    this.d.persist({ micDevice: id });
    this.patchUi({ inputId: id });
    if (this.mic.state === 'live' || this.mic.state === 'starting') await this.mic.start(id);
    else this.mic.deviceId = id;
  }

  async setSpeaker(id: string): Promise<void> {
    this.d.persist({ speakerDevice: id });
    await this.applySpeaker(id);
  }

  async setProcessing(p: MicProcessing): Promise<void> {
    this.d.persist({ micProcessing: { ...p } });
    this.patchUi({ ...p });
    await this.mic.setProcessing(p);
  }

  /** Device lists (labels appear once the microphone is allowed). */
  async refreshDevices(): Promise<void> {
    const seq = ++this.devicesSeq;
    const list = await this.d.platform.mediaDevices.list().catch(() => []);
    if (seq !== this.devicesSeq) return;
    // Chromium's 'default' entry duplicates our own "system default" choice.
    const pick = (kind: 'audioinput' | 'audiooutput'): DeviceUi[] =>
      list
        .filter((e) => e.kind === kind && e.id !== '' && e.id !== 'default')
        .map((e) => ({ id: e.id, label: e.label }));
    this.patchUi({ inputs: pick('audioinput'), outputs: pick('audiooutput') });
  }

  /** Once per frame: level, speaking, the muted hint, and the meter while it is visible. */
  update(dt: number): void {
    this.mic.update(dt);
    const det = this.mic.detector;
    if (this.mic.state !== 'live' || this.mic.transmitting || this.deafened) this.mutedTalk = 0;
    else if (det.speaking) {
      this.mutedTalk += dt;
      this.mutedQuiet = 0;
    } else if ((this.mutedQuiet += dt) > MUTED_HINT_HOLD) this.mutedTalk = 0;
    const s = this.d.store.getState();
    this.previewing = s.lobby?.step === 'ready';
    let level = this.ui.level;
    this.meterTimer -= dt;
    if (s.lobby === null && !s.settingsOpen) level = 0;
    else if (this.meterTimer <= 0) {
      this.meterTimer = 1 / METER_HZ;
      level = Math.round(det.level * 40) / 40;
    }
    this.patchUi({
      speaking: this.speaking,
      mutedSpeaking: this.mutedTalk >= MUTED_HINT_AFTER,
      level,
    });
  }

  /** Leaving the room: the microphone goes off and the next room starts muted again. */
  stop(): void {
    this.cancelEcho();
    this.muted = true;
    this.deafened = false;
    this.pushed = false;
    this.mic.stop();
    this.apply();
  }

  /** Partial update of the HUD's voice state (only pushed when something changed). */
  patchUi(patch: Partial<VoiceUi>): void {
    const ui = this.ui;
    let changed = false;
    for (const k of Object.keys(patch) as (keyof VoiceUi)[]) {
      if (ui[k] !== patch[k]) changed = true;
    }
    if (!changed) return;
    this.ui = { ...ui, ...patch };
    this.d.store.setState({ voice: this.ui });
  }

  dispose(): void {
    this.cancelEcho();
    this.mic.dispose();
  }

  /** Plays a recorded clip through the room's audio output (so the chosen speaker is tested). */
  private async playClip(clip: Blob, signal: AbortSignal): Promise<void> {
    const audio = this.d.platform.audio;
    await audio.resume().catch(() => undefined);
    const ctx = audio.get();
    const buffer = await ctx.decodeAudioData(await clip.arrayBuffer());
    if (signal.aborted) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    await new Promise<void>((resolve) => {
      source.addEventListener(
        'ended',
        () => {
          source.disconnect();
          resolve();
        },
        { once: true },
      );
      signal.addEventListener('abort', () => source.stop(), { once: true });
      source.start();
    });
  }

  private apply(): void {
    // Deafened people do not talk either; push-to-talk works while muted.
    this.mic.setMuted(this.muted || this.deafened);
    this.mic.setPushToTalk(this.pushed && !this.deafened);
    this.sync();
    this.d.onChange();
  }

  private sync(): void {
    this.patchUi({
      mic: this.mic.state,
      muted: this.muted,
      deafened: this.deafened,
      talking: this.pushed,
      inputId: this.mic.deviceId,
    });
  }

  private async applySpeaker(id: string): Promise<void> {
    try {
      const ok = await this.d.platform.audio.setOutputDevice(id);
      this.patchUi({ outputId: ok ? id : null, outputSupported: ok });
    } catch (err: unknown) {
      this.d.log.warn('speaker switch failed', errorMessage(err));
      pushToast(this.d.store, 'voice.speakerFailed', 'warn');
    }
  }
}
