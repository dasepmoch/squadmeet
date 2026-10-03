import { cleanName, NET, sanitizeChat, type ClientMessage, type HostCommand } from '@huddle/shared';
import { present, relaySignal, voiceState } from './media-handlers.ts';
import type { Member } from './member.ts';
import { act, hit, hold, pickup, score, shield, throwAt } from './play-handlers.ts';
import type { Room } from './room.ts';

/** How far (meters) from a seat someone may claim it; generous to cover latency. */
const SEAT_REACH = 4;

type Msg<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>;

/** Applies one validated client message from a joined member. Never trusts the client. */
export function handleMessage(room: Room, m: Member, msg: ClientMessage): void {
  const now = room.now;
  switch (msg.t) {
    case 'hello':
      // Only valid as the first message; the manager consumed it.
      return;
    case 'ping':
      if (m.limits.ping.take(now)) room.send(m, { t: 'pong', c: msg.c, s: now });
      return;
    case 'chat':
      chat(room, m, msg.text, now);
      return;
    case 'act':
      act(room, m, msg, now);
      return;
    case 'react':
      if (m.limits.act.take(now)) room.broadcast({ t: 'react', id: m.id, emoji: msg.emoji }, m);
      return;
    case 'hand':
      hand(room, m, msg.raised, now);
      return;
    case 'sit':
      sit(room, m, msg.seat, now);
      return;
    case 'stand':
      if (m.seat && m.limits.seat.take(now)) room.setSeat(m.seat, null);
      return;
    case 'throw':
      throwAt(room, m, msg, now);
      return;
    case 'hit':
      hit(room, m, msg, now);
      return;
    case 'score':
      score(room, m, msg, now);
      return;
    case 'hold':
      hold(room, m, msg, now);
      return;
    case 'pickup':
      pickup(room, m, msg, now);
      return;
    case 'shield':
      shield(room, m, msg.on, now);
      return;
    case 'profile':
      profile(room, m, msg, now);
      return;
    case 'host':
      host(room, m, msg.cmd, now);
      return;
    case 'signal':
      relaySignal(room, m, msg, now);
      return;
    case 'voice':
      voiceState(room, m, msg, now);
      return;
    case 'present':
      present(room, m, msg.on, now);
      return;
  }
}

function chat(room: Room, m: Member, raw: string, now: number): void {
  if (!m.limits.chat.take(now)) {
    room.send(m, { t: 'error', code: 'rate', message: 'Slow down a little.' });
    return;
  }
  const text = sanitizeChat(raw);
  if (!text) return;
  const line = { n: room.chatSeq++, from: m.id, name: m.name, text, at: now };
  room.chat.push(line);
  if (room.chat.length > NET.chatHistory) room.chat.splice(0, room.chat.length - NET.chatHistory);
  room.broadcast({ t: 'chat', line });
}

function hand(room: Room, m: Member, raised: boolean, now: number): void {
  if (!m.limits.hand.take(now)) return;
  if (raised === (m.hand !== null)) return;
  m.hand = raised ? now : null;
  room.broadcast({ t: 'hand', id: m.id, raised, at: now });
}

function sit(room: Room, m: Member, seatId: string, now: number): void {
  if (!m.limits.seat.take(now)) return;
  const seat = room.resolved.seats.find((s) => s.id === seatId);
  const owner = room.seats.get(seatId);
  const near =
    seat !== undefined &&
    (m.seat !== null ||
      Math.hypot(seat.position[0] - m.pose.x, seat.position[2] - m.pose.z) <= SEAT_REACH);
  if (!seat || !near || (owner !== undefined && owner !== m.id)) {
    room.send(m, { t: 'seatDenied', seat: seatId });
    return;
  }
  room.setSeat(seatId, m.id);
}

function profile(room: Room, m: Member, msg: Msg<'profile'>, now: number): void {
  if (!m.limits.profile.take(now)) return;
  if (msg.name !== undefined) m.name = cleanName(msg.name, m.name);
  if (msg.avatar !== undefined) m.avatar = msg.avatar;
  room.broadcast({ t: 'profile', id: m.id, name: m.name, avatar: m.avatar });
}

function host(room: Room, m: Member, cmd: HostCommand, now: number): void {
  if (room.hostId !== m.id) {
    room.send(m, { t: 'error', code: 'forbidden', message: 'Only the host can do that.' });
    return;
  }
  if (!m.limits.host.take(now)) return;
  switch (cmd.op) {
    case 'mode':
      room.mode = cmd.mode;
      room.announce();
      return;
    case 'lockThrows':
      room.throwsLocked = cmd.locked;
      room.announce();
      return;
    case 'voiceMode':
      room.voice = cmd.mode;
      room.announce();
      return;
    case 'stopShare':
      if (room.presenterId === null) return;
      room.presenterId = null;
      room.announce();
      return;
    case 'muteAll':
      room.broadcast({ t: 'muteRequest', by: m.id }, m);
      return;
    case 'clean':
      // Everyone mops at once, the host included (one code path for every client).
      room.broadcast({ t: 'clean', by: m.id });
      return;
    case 'resetScores':
      for (const x of room.members.values()) x.points = 0;
      room.broadcast({ t: 'scoreReset', by: m.id });
      return;
    default:
      break;
  }
  const target = room.members.get(cmd.target);
  if (!target) return;
  if (cmd.op === 'lowerHand') {
    if (target.hand === null) return;
    target.hand = null;
    room.broadcast({ t: 'hand', id: target.id, raised: false, at: now });
  } else if (cmd.op === 'transfer') {
    room.hostId = target.id;
    room.announce();
  } else if (target !== m) {
    room.send(target, { t: 'error', code: 'kicked', message: 'The host removed you.' });
    target.peer?.close(4003, 'kicked');
    room.remove(target, 'kick');
  }
}
