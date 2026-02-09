/**
 * Monotonic ULID generator.
 * Time-sortable, no collisions, works offline.
 * 26-char Crockford Base32 string.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length; // 32

let lastTime = 0;
let lastRandom = new Uint8Array(10);

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

function encodeTime(time: number, len: number): string {
  let str = "";
  for (let i = len - 1; i >= 0; i--) {
    const mod = time % ENCODING_LEN;
    str = ENCODING[mod] + str;
    time = Math.floor(time / ENCODING_LEN);
  }
  return str;
}

function encodeRandom(bytes: Uint8Array): string {
  // Encode 10 bytes as 16 characters of Crockford Base32
  let str = "";
  // We need 80 bits (10 bytes) encoded as 16 base32 chars (5 bits each = 80 bits)
  const bits: number[] = [];
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((b >> i) & 1);
    }
  }
  for (let i = 0; i < 80; i += 5) {
    const val =
      (bits[i] << 4) |
      (bits[i + 1] << 3) |
      (bits[i + 2] << 2) |
      (bits[i + 3] << 1) |
      bits[i + 4];
    str += ENCODING[val];
  }
  return str;
}

function incrementRandom(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes);
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i] < 255) {
      result[i]++;
      return result;
    }
    result[i] = 0;
  }
  // Overflow — extremely unlikely
  return randomBytes(10);
}

export function ulid(): string {
  const now = Date.now();

  if (now <= lastTime) {
    // Same millisecond — increment random for monotonicity
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomBytes(10);
  }

  return encodeTime(now, 10) + encodeRandom(lastRandom);
}
