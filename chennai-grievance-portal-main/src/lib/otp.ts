import crypto from "crypto";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import {
  OTP_LENGTH,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS
} from "@/lib/constants";
import { RowDataPacket, ResultSetHeader } from "mysql2";

export type OtpPurpose =
  | "password_reset"
  | "mobile_verify"
  | "complaint_mobile_verify"
  | "email_verify";

/**
 * Cryptographically secure numeric code. crypto.randomInt is uniform over the
 * range (no modulo bias) — Math.random() is predictable and must not be used
 * for anything that authenticates a user.
 */
function generateOtp(): string {
  const min = 10 ** (OTP_LENGTH - 1);
  const max = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(min, max));
}

export interface CreateOtpResult {
  otp: string;
  /** Set when the caller must wait before requesting another code. */
  cooldownRemaining?: number;
}

/**
 * Creates and stores a new (hashed) OTP for the given identifier + purpose,
 * invalidating any previous unused code for that pair. Enforces the resend
 * cooldown. Returns the plaintext OTP so the caller can deliver it.
 *
 * The plaintext is never persisted and never logged.
 */
export async function createOtp(
  identifier: string,
  purpose: OtpPurpose,
  userId: number | null
): Promise<CreateOtpResult> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT created_at FROM password_resets
     WHERE identifier = ? AND purpose = ? AND used = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose]
  );

  if (rows.length > 0) {
    const lastCreated = new Date(rows[0].created_at as string).getTime();
    const elapsedSeconds = (Date.now() - lastCreated) / 1000;
    if (elapsedSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
      return {
        otp: "",
        cooldownRemaining: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds)
      };
    }
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Supersede any previous unused code so only the newest one can be used.
  await pool.query(
    `UPDATE password_resets SET used = TRUE
     WHERE identifier = ? AND purpose = ? AND used = FALSE`,
    [identifier, purpose]
  );

  await pool.query<ResultSetHeader>(
    `INSERT INTO password_resets (user_id, purpose, identifier, otp_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, purpose, identifier, otpHash, expiresAt]
  );

  return { otp };
}

/** Deletes any outstanding code, e.g. after a failed delivery attempt. */
export async function discardOtp(identifier: string, purpose: OtpPurpose): Promise<void> {
  await pool.query(
    `UPDATE password_resets SET used = TRUE
     WHERE identifier = ? AND purpose = ? AND used = FALSE`,
    [identifier, purpose]
  );
}

export type OtpFailureReason =
  | "not_found"
  | "expired"
  | "too_many_attempts"
  | "incorrect";

export type OtpVerifyResult =
  | { ok: true; userId: number | null }
  | { ok: false; reason: OtpFailureReason; attemptsRemaining?: number };

/**
 * Verifies a submitted code and, on success, consumes it in the same step.
 *
 * Consumption is a conditional UPDATE (`used = FALSE` in the WHERE clause), so
 * two concurrent requests carrying the same correct code cannot both succeed:
 * exactly one UPDATE reports an affected row, and the loser is told the code is
 * no longer valid. Separate verify-then-consume calls would leave that race
 * open.
 */
export async function verifyAndConsumeOtp(
  identifier: string,
  purpose: OtpPurpose,
  submittedOtp: string
): Promise<OtpVerifyResult> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, otp_hash, expires_at, attempts FROM password_resets
     WHERE identifier = ? AND purpose = ? AND used = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose]
  );

  if (rows.length === 0) return { ok: false, reason: "not_found" };

  const record = rows[0];

  if (new Date(record.expires_at as string).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  if ((record.attempts as number) >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  const matches = await bcrypt.compare(submittedOtp, record.otp_hash as string);

  if (!matches) {
    // Count the attempt in the database so it survives a process restart and
    // is shared across server instances.
    const [res] = await pool.query<ResultSetHeader>(
      `UPDATE password_resets SET attempts = attempts + 1
       WHERE id = ? AND used = FALSE AND attempts < ?`,
      [record.id, OTP_MAX_ATTEMPTS]
    );
    const usedAttempts = (record.attempts as number) + (res.affectedRows === 1 ? 1 : 0);
    const attemptsRemaining = Math.max(0, OTP_MAX_ATTEMPTS - usedAttempts);
    if (attemptsRemaining === 0) return { ok: false, reason: "too_many_attempts" };
    return { ok: false, reason: "incorrect", attemptsRemaining };
  }

  // Atomically claim the code.
  const [consumed] = await pool.query<ResultSetHeader>(
    `UPDATE password_resets SET used = TRUE WHERE id = ? AND used = FALSE`,
    [record.id]
  );
  if (consumed.affectedRows !== 1) {
    // Another request consumed it between our SELECT and this UPDATE.
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, userId: (record.user_id as number | null) ?? null };
}

/** Seconds the caller must wait before a new code may be requested, or 0. */
export async function getResendCooldown(
  identifier: string,
  purpose: OtpPurpose
): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT created_at FROM password_resets
     WHERE identifier = ? AND purpose = ? AND used = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose]
  );
  if (rows.length === 0) return 0;
  const elapsed = (Date.now() - new Date(rows[0].created_at as string).getTime()) / 1000;
  return Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed));
}

// ---------------------------------------------------------------------------
// Back-compat wrappers for the existing password-reset / mobile-OTP routes.
// `verifyOtp` does NOT consume the code, because the password-reset flow
// verifies the code on one screen and consumes it when the new password is
// submitted on the next one.
// ---------------------------------------------------------------------------
export async function verifyOtp(
  identifier: string,
  purpose: OtpPurpose,
  submittedOtp: string
): Promise<{ ok: true } | { ok: false; reason: OtpFailureReason }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, otp_hash, expires_at, attempts FROM password_resets
     WHERE identifier = ? AND purpose = ? AND used = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose]
  );

  if (rows.length === 0) return { ok: false, reason: "not_found" };
  const record = rows[0];

  if (new Date(record.expires_at as string).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if ((record.attempts as number) >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  const matches = await bcrypt.compare(submittedOtp, record.otp_hash as string);
  if (!matches) {
    await pool.query(
      `UPDATE password_resets SET attempts = attempts + 1 WHERE id = ? AND used = FALSE`,
      [record.id]
    );
    return { ok: false, reason: "incorrect" };
  }
  return { ok: true };
}

/** Marks the most recent unused OTP for this identifier/purpose as used. */
export async function consumeOtp(identifier: string, purpose: OtpPurpose): Promise<void> {
  await pool.query(
    `UPDATE password_resets SET used = TRUE
     WHERE identifier = ? AND purpose = ? AND used = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose]
  );
}

/**
 * Returns the plaintext code ONLY when this is a non-production build AND the
 * developer opt-in flag is set. Both conditions are required, so setting
 * NEXT_PUBLIC_DEV_SHOW_OTP=true in a production environment by mistake still
 * cannot leak a code through an API response or the UI.
 *
 * Every route that might echo a code back must go through this helper.
 */
export function devOtpForResponse(otp: string): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  if (process.env.NEXT_PUBLIC_DEV_SHOW_OTP !== "true") return undefined;
  return otp || undefined;
}
