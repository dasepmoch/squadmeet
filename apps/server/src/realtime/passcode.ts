import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 32;

function derive(passcode: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passcode.normalize('NFKC'), salt, length, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** `salt.key` (base64url) with scrypt; room passcodes are never stored in the clear. */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(passcode, salt, KEY_BYTES);
  return `${salt.toString('base64url')}.${key.toString('base64url')}`;
}

export async function verifyPasscode(passcode: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split('.');
  if (!salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(passcode, Buffer.from(salt, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
