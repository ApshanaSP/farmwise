import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { forgotPasswordResetSchema } from "@/lib/validators";
import { verifyOtp, consumeOtp } from "@/lib/otp";
import { RowDataPacket } from "mysql2";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = forgotPasswordResetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { email, otp, newPassword } = parsed.data;

    // Re-verify the OTP at reset time too (defense in depth — the OTP
    // must still be valid, unused, and not over the attempt limit).
    const verifyResult = await verifyOtp(email, "password_reset", otp);
    if (!verifyResult.ok) {
      return NextResponse.json({ error: "OTP is invalid or has expired. Please start over." }, { status: 400 });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, rows[0].id]);

    await consumeOtp(email, "password_reset");

    return NextResponse.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("[api/auth/forgot-password/reset-password]", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
