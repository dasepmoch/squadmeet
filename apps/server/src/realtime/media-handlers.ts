import type { ClientMessage } from '@huddle/shared';
import type { Member } from './member.ts';
import type { Room } from './room.ts';

type Msg<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>;

/**
 * Relays WebRTC signaling to one peer. Only between connected media peers of the same room (the
 * mesh cap), never to oneself: the server does not read SDP, it only routes it.
 */
export function relaySignal(room: Room, m: Member, msg: Msg<'signal'>, now: number): void {
  if (!m.limits.signal.take(now) || msg.to === m.id) return;
  const target = room.members.get(msg.to);
  if (!target?.peer) return;
  const peers = room.mediaPeerIds();
  if (!peers.has(m.id) || !peers.has(target.id)) return;
  room.send(target, { t: 'signal', from: m.id, data: msg.data });
}

/** Mute and deafen state, so name tags show it and the host knows who can hear. */
export function voiceState(room: Room, m: Member, msg: Msg<'voice'>, now: number): void {
  if (!m.limits.voice.take(now)) return;
  if (m.muted === msg.muted && m.deafened === msg.deafened) return;
  m.muted = msg.muted;
  m.deafened = msg.deafened;
  room.broadcast({ t: 'voice', id: m.id, muted: m.muted, deafened: m.deafened }, m);
}

/**
 * One presenter at a time. A free slot goes to whoever asks; the host can take it over; anyone
 * else hears "busy" and the presenter gets a handoff request.
 */
export function present(room: Room, m: Member, on: boolean, now: number): void {
  if (!m.limits.present.take(now)) return;
  const current = room.presenterId;
  if (!on) {
    if (current !== m.id) return;
    room.presenterId = null;
    room.announce();
    return;
  }
  if (current === m.id) return;
  const holder = current === null ? undefined : room.members.get(current);
  if (!holder || room.hostId === m.id) {
    room.presenterId = m.id;
    room.announce();
    return;
  }
  room.send(m, { t: 'error', code: 'busy', message: 'Someone else is presenting.' });
  room.send(holder, { t: 'presentRequest', from: m.id });
}
