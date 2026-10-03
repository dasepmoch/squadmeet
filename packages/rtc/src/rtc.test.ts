import { createLogger, type SignalData, type VoiceZone } from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import { MeshTransport } from './mesh-transport.ts';
import { withOpusDtx } from './sdp.ts';
import { SpeakingDetector } from './speaking.ts';
import { fakeFactory, FakeStream, FakeTrack, type FakePC } from './testing/fake-webrtc.ts';
import { proximityGain, voiceRoute } from './voice-routing.ts';

const log = createLogger(() => undefined, 'test', 'error');

describe('sdp', () => {
  it('asks for Opus DTX on every Opus payload, once', () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10;useinbandfec=1',
      'a=rtpmap:63 red/48000/2',
      'a=fmtp:63 111/111',
      '',
    ].join('\r\n');
    const out = withOpusDtx(sdp);
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1\r\n');
    expect(out).toContain('a=fmtp:63 111/111\r\n');
    expect(withOpusDtx(out)).toBe(out);
  });
});

describe('voice routing', () => {
  const zones: VoiceZone[] = [
    { id: 'meeting', mode: 'global', min: [-5, -5], max: [5, 5] },
    { id: 'lounge', mode: 'proximity', min: [6, -5], max: [12, 5] },
  ];
  it('is global inside the same global zone and proximity elsewhere', () => {
    const at = (x: number) => ({ x, z: 0 });
    expect(voiceRoute('zones', zones, at(0), at(4))).toBe('global');
    expect(voiceRoute('zones', zones, at(0), at(8))).toBe('proximity');
    expect(voiceRoute('zones', zones, at(8), at(9))).toBe('proximity');
    expect(voiceRoute('zones', zones, at(20), at(0))).toBe('proximity');
    expect(voiceRoute('global', zones, at(20), at(0))).toBe('global');
    expect(voiceRoute('proximity', zones, at(0), at(1))).toBe('proximity');
  });

  it('fades proximity voices with distance', () => {
    expect(proximityGain(0.5)).toBe(1);
    expect(proximityGain(4)).toBeLessThan(proximityGain(2));
    expect(proximityGain(12)).toBeLessThan(0.1);
  });
});

describe('speaking detection', () => {
  it('needs a short attack, bridges pauses between words and releases after silence', () => {
    const d = new SpeakingDetector();
    const run = (value: number, seconds: number): boolean => {
      for (let t = 0; t < seconds; t += 0.01) d.update(value, 0.01);
      return d.speaking;
    };
    expect(run(0.08, 0.03)).toBe(false);
    expect(run(0.08, 0.1)).toBe(true);
    expect(d.level).toBeGreaterThan(0.5);
    expect(run(0.005, 0.2)).toBe(true);
    expect(run(0.005, 0.3)).toBe(false);
    expect(d.level).toBeLessThan(0.1);
  });
});

/** Two transports wired through an asynchronous in-memory signaling relay. */
function pair(): {
  a: MeshTransport;
  b: MeshTransport;
  pcs: FakePC[];
  remote: Record<'A' | 'B', { mic: FakeStream | null; screen: FakeStream | null }>;
  settle: () => Promise<void>;
} {
  const pcs: FakePC[] = [];
  const transports = new Map<string, MeshTransport>();
  let pending = 0;
  const send = (from: string, to: string, data: SignalData): void => {
    pending++;
    setTimeout(() => {
      pending--;
      transports.get(to)?.handleSignal(from, data);
    }, 1);
  };
  const make = (id: string): MeshTransport =>
    new MeshTransport({
      selfId: id,
      factory: fakeFactory(pcs),
      sendSignal: (to, data) => send(id, to, data),
      log,
      createStream: () => new FakeStream() as unknown as MediaStream,
    });
  const a = make('pA');
  const b = make('pB');
  transports.set('pA', a);
  transports.set('pB', b);
  const remote = { A: { mic: null, screen: null }, B: { mic: null, screen: null } } as Record<
    'A' | 'B',
    { mic: FakeStream | null; screen: FakeStream | null }
  >;
  a.events.on('remote', (e) => {
    remote.A = { mic: e.mic as unknown as FakeStream, screen: e.screen as unknown as FakeStream };
  });
  b.events.on('remote', (e) => {
    remote.B = { mic: e.mic as unknown as FakeStream, screen: e.screen as unknown as FakeStream };
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 2));
      if (pending === 0 && pcs.every((pc) => pc.signalingState === 'stable')) {
        await new Promise((r) => setTimeout(r, 5));
        if (pending === 0) return;
      }
    }
    throw new Error('negotiation did not settle');
  };
  return { a, b, pcs, remote, settle };
}

const mic = (): MediaStreamTrack => new FakeTrack('audio') as unknown as MediaStreamTrack;

describe('mesh transport (perfect negotiation)', () => {
  it('converges when both sides start sending at once (offer glare)', async () => {
    const { a, b, pcs, remote, settle } = pair();
    a.setPeers(['pB']);
    b.setPeers(['pA']);
    a.publishMic(mic());
    b.publishMic(mic());
    await settle();
    expect(pcs).toHaveLength(2);
    for (const pc of pcs) {
      expect(pc.signalingState).toBe('stable');
      expect(pc.connectionState).toBe('connected');
    }
    expect(remote.A.mic?.getAudioTracks().length).toBeGreaterThan(0);
    expect(remote.B.mic?.getAudioTracks().length).toBeGreaterThan(0);
    expect(remote.B.screen).toBeNull();
  });

  it('shares and stops a screen; muting and re-sharing need no new offers', async () => {
    const { a, b, pcs, remote, settle } = pair();
    a.setPeers(['pB']);
    b.setPeers(['pA']);
    a.publishMic(mic());
    await settle();
    const screen = new FakeStream([new FakeTrack('video')]) as unknown as MediaStream;
    a.publishScreen(screen, 'detail');
    await settle();
    expect(remote.B.screen?.getVideoTracks()).toHaveLength(1);
    expect(remote.B.mic).not.toBe(remote.B.screen);
    const offers = pcs.reduce((n, pc) => n + pc.offers, 0);
    a.publishScreen(null, 'detail');
    await settle();
    expect(remote.B.screen).toBeNull();
    a.publishMic(mic());
    a.publishScreen(new FakeStream([new FakeTrack('video')]) as unknown as MediaStream, 'motion');
    await settle();
    expect(remote.B.screen?.getVideoTracks()).toHaveLength(1);
    expect(pcs.reduce((n, pc) => n + pc.offers, 0)).toBe(offers);
    // Screen bitrate cap is applied once the sender is negotiated.
    const sender = (
      pcs[0] as unknown as { senders: { params: { encodings: { maxBitrate?: number }[] } }[] }
    ).senders;
    expect(sender.some((s) => (s.params.encodings[0]?.maxBitrate ?? 0) > 0)).toBe(true);
  });

  it('restarts ICE when a connection fails and closes links to people who left', async () => {
    const { a, b, pcs, settle } = pair();
    a.setPeers(['pB']);
    b.setPeers(['pA']);
    a.publishMic(mic());
    await settle();
    const removed: string[] = [];
    a.events.on('peerRemoved', (e) => removed.push(e.peerId));
    pcs[0]?.fail();
    expect(pcs[0]?.restarts).toBe(1);
    await settle();
    a.setPeers([]);
    expect(removed).toEqual(['pB']);
    expect(pcs[0]?.signalingState).toBe('closed');
    // Signals from people outside the mesh are ignored.
    a.handleSignal('pB', { streams: { mic: null, screen: null } });
    expect(a.peerIds).toEqual([]);
  });
});
