import { NextRequest, NextResponse } from "next/server";
import { forgotPasswordVerifySchema } from "@/lib/validators";
import { verifyOtp } from "@/lib/otp";

const OTP_ERROR_MESSAGES: Record<string, string> = {
  not_found: "No OTP request found. Please request a new OTP.",
  expired: "This OTP has expired. Please request a new one.",
  too_many_attempts: "Too many incorrect attempts. Please request a new OTP.",
  incorrect: "Incorrect OTP. Please try again."
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = forgotPasswordVerifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { email, otp } = parsed.data;
    const result = await verifyOtp(email, "password_reset", otp);

    if (!result.ok) {
      return NextResponse.json({ error: OTP_ERROR_MESSAGES[result.reason] }, { status: 400 });
    }

    return NextResponse.json({ message: "OTP verified. You can now reset your password." });
  } catch (err) {
    console.error("[api/auth/forgot-password/verify-otp]", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
