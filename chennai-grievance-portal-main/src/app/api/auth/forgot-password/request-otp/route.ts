import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { forgotPasswordRequestSchema } from "@/lib/validators";
import { createOtp, devOtpForResponse } from "@/lib/otp";
import { sendMail, otpEmailHtml } from "@/lib/mailer";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RowDataPacket } from "mysql2";

const GENERIC_MESSAGE =
  "If an account exists with this email, an OTP has been sent to it.";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const rl = checkRateLimit(`fp-request:${ip}`, 10, 60 * 15);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const body = await req.json();
    const parsed = forgotPasswordRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { email } = parsed.data;

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    // Always return the generic message, whether or not the account
    // exists, so the endpoint can't be used to enumerate registered
    // emails. Only actually send an OTP if the account exists.
    if (rows.length > 0) {
      const userId = rows[0].id as number;
      const result = await createOtp(email, "password_reset", userId);

      if (result.cooldownRemaining) {
        return NextResponse.json(
          { message: GENERIC_MESSAGE, cooldownRemaining: result.cooldownRemaining },
          { status: 200 }
        );
      }

      await sendMail(email, "Your password reset OTP", otpEmailHtml(result.otp, "password reset"));

      const devOtp = devOtpForResponse(result.otp);
      return NextResponse.json({ message: GENERIC_MESSAGE, devOtp });
    }

    return NextResponse.json({ message: GENERIC_MESSAGE });
  } catch (err) {
    console.error("[api/auth/forgot-password/request-otp]", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
