import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { mobileSchema, otpSchema } from "@/lib/validators";
import { verifyOtp, consumeOtp } from "@/lib/otp";
import { RowDataPacket } from "mysql2";

const OTP_ERROR_MESSAGES: Record<string, string> = {
  not_found: "No OTP request found. Please request a new OTP.",
  expired: "This OTP has expired. Please request a new one.",
  too_many_attempts: "Too many incorrect attempts. Please request a new OTP.",
  incorrect: "Incorrect OTP. Please try again."
};

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const mobileParsed = mobileSchema.safeParse(body.mobileNumber);
  const otpParsed = otpSchema.safeParse(body.otp);
  if (!mobileParsed.success || !otpParsed.success) {
    return NextResponse.json({ error: "Invalid mobile number or OTP." }, { status: 400 });
  }
  const mobileNumber = mobileParsed.data;
  const otp = otpParsed.data;

  const result = await verifyOtp(mobileNumber, "mobile_verify", otp);
  if (!result.ok) {
    return NextResponse.json({ error: OTP_ERROR_MESSAGES[result.reason] }, { status: 400 });
  }
  await consumeOtp(mobileNumber, "mobile_verify");

  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM user_profiles WHERE user_id = ?",
    [session.userId]
  );

  if (existing.length === 0) {
    await pool.query(
      "INSERT INTO user_profiles (user_id, mobile_number, mobile_verified) VALUES (?, ?, TRUE)",
      [session.userId, mobileNumber]
    );
  } else {
    await pool.query(
      "UPDATE user_profiles SET mobile_number = ?, mobile_verified = TRUE WHERE user_id = ?",
      [mobileNumber, session.userId]
    );
  }

  return NextResponse.json({ message: "Mobile number verified and updated successfully." });
}
