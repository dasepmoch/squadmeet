import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A WAV file Chrome plays as the fake microphone (`--use-file-for-fake-audio-capture`): a voice-
 * like tone in syllables (0.35 s on, 0.15 s off), loud enough for speaking detection. Chrome's
 * built-in fake microphone only beeps for a few milliseconds, which never counts as speaking.
 */
export function fakeVoiceFile(): string {
  const path = join(tmpdir(), 'huddle-e2e-voice-v1.wav');
  if (existsSync(path)) return path;
  const rate = 48_000;
  const seconds = 4;
  const samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const phase = t % 0.5;
    // Soft edges so syllables do not click.
    const env = phase < 0.35 ? Math.min(1, phase / 0.02, (0.35 - phase) / 0.02) : 0;
    const v =
      env * 0.35 * (Math.sin(2 * Math.PI * 220 * t) + 0.4 * Math.sin(2 * Math.PI * 440 * t));
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
  return path;
}
