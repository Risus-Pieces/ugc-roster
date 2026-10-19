import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for OAuth tokens and tax IDs at rest. Set ENCRYPTION_KEY (any long random
 * string) in production; the dev fallback is fine locally but must never ship.
 */
function key() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY is required in production");
  return createHash("sha256").update(secret ?? "dev-only-insecure-key").digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
