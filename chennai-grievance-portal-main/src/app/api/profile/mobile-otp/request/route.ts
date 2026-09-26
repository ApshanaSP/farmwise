import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { mobileSchema } from "@/lib/validators";
import { createOtp, devOtpForResponse } from "@/lib/otp";
import { sendMail, otpEmailHtml } from "@/lib/mailer";
import { RowDataPacket } from "mysql2";

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = mobileSchema.safeParse(body.mobileNumber);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const mobileNumber = parsed.data;

  const [dupRows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM user_profiles WHERE mobile_number = ? AND user_id != ?",
    [mobileNumber, session.userId]
  );
  if (dupRows.length > 0) {
    return NextResponse.json({ error: "This mobile number is already registered to another account." }, { status: 409 });
  }

  const result = await createOtp(mobileNumber, "mobile_verify", session.userId);
  if (result.cooldownRemaining) {
    return NextResponse.json({ message: "OTP already sent.", cooldownRemaining: result.cooldownRemaining });
  }

  await sendMail(session.email, "Verify your mobile number", otpEmailHtml(result.otp, "mobile number verification"));

  const devOtp = devOtpForResponse(result.otp);
  return NextResponse.json({ message: "OTP sent.", devOtp });
}
