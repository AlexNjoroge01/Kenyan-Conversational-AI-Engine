import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";
import { API_KEY_DISPLAY_PREFIX_LENGTH, API_KEY_RANDOM_BYTES } from "../config/constants";

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: env.BCRYPT_COST });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

/** Runs a password verification against a dummy hash so login timing doesn't reveal whether an email exists. */
let dummyHash: Promise<string> | undefined;
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummyHash);
}

/**
 * API keys carry 256 bits of randomness, so a fast SHA-256 is sufficient (and lets us
 * look keys up by hash). Passwords use bcrypt instead because they are low-entropy.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; keyPrefix: string; keyHash: string } {
  const key = `${env.API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString("base64url")}`;
  return { key, keyPrefix: key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH), keyHash: hashApiKey(key) };
}

export function generateRequestId(): string {
  return `req_${randomBytes(9).toString("base64url")}`;
}

/** Parses durations like "15m", "12h", "7d" into milliseconds. */
export function durationToMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return Number(match[1]) * unit;
}
