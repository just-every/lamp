import { z } from "zod";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A canonical, uppercase ULID used for every persisted Lamp entity. */
export const ulidSchema = z.string().regex(
  /^[0-9A-HJKMNP-TV-Z]{26}$/,
  "Expected a canonical ULID.",
);

function encodeTime(time: number) {
  let remaining = time;
  let output = "";

  for (let index = 0; index < 10; index += 1) {
    output = CROCKFORD[remaining % 32] + output;
    remaining = Math.floor(remaining / 32);
  }

  return output;
}

function encodeRandomness() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < 16) {
      bits -= 5;
      output += CROCKFORD[(buffer >>> bits) & 31];
    }
  }

  return output.padEnd(16, "0");
}

export function createUlid(now = Date.now()) {
  return `${encodeTime(now)}${encodeRandomness()}`;
}

export function nowIso() {
  return new Date().toISOString();
}
