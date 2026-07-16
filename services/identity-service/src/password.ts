import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
const hashLength = 64;

export const dummyPasswordHash =
  'scrypt$00000000000000000000000000000000$36c758b0b46e56f70ad4027169e2a544e902b0fd4de55a6b2e35901bedb8405bb766fdbafe10880c0d4c0c08f62af48adc2d869f59ba768c405f7f960a0fe024';

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return false;
  const actual = await derivePassword(password, parsed.salt);
  return actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected);
}

function parsePasswordHash(value: string): { salt: Buffer; expected: Buffer } | null {
  const [algorithm, saltHex, hashHex, extra] = value.split('$');
  if (
    algorithm !== 'scrypt' ||
    extra !== undefined ||
    typeof saltHex !== 'string' ||
    typeof hashHex !== 'string' ||
    !/^[a-f0-9]{32}$/i.test(saltHex) ||
    !/^[a-f0-9]{128}$/i.test(hashHex)
  ) {
    return null;
  }
  return { salt: Buffer.from(saltHex, 'hex'), expected: Buffer.from(hashHex, 'hex') };
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      hashLength,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}
