import crypto from "crypto";

// Simple AES-256-GCM encryption for Aadhaar-at-rest. The key is derived
// from JWT_SECRET so no extra env var is strictly required, but for a
// real deployment you should set a dedicated AADHAAR_ENCRYPTION_KEY.
const RAW_KEY = process.env.AADHAAR_ENCRYPTION_KEY || process.env.JWT_SECRET || "dev_only_key";
const KEY = crypto.createHash("sha256").update(RAW_KEY).digest(); // 32 bytes

export function encryptAadhaar(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptAadhaar(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function maskAadhaar(last4: string | null): string {
  if (!last4) return "";
  return `XXXX-XXXX-${last4}`;
}
