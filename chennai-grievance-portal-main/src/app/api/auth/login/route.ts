import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { loginSchema } from "@/lib/validators";
import { signToken } from "@/lib/jwt";
import { setAuthCookie } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RowDataPacket } from "mysql2";
import { UserRow } from "@/types";

const GENERIC_ERROR = "Invalid email or password.";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
    }

    const { email, password } = parsed.data;
    const ip = getClientIp(req.headers);

    // Rate limit by IP and by email to slow down brute force / credential
    // stuffing without letting one IP lock out a legitimate user forever.
    const ipLimit = checkRateLimit(`login-ip:${ip}`, 20, 60 * 15);
    const emailLimit = checkRateLimit(`login-email:${email}`, 8, 60 * 15);

    if (!ipLimit.allowed || !emailLimit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    const user = rows[0] as UserRow;

    if (!user.is_active) {
      return NextResponse.json({ error: "This account has been deactivated." }, { status: 403 });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    const token = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.department_id
    });

    let redirectTo = "/login";
    if (user.role === "citizen") redirectTo = "/citizen";
    else if (user.role === "department_officer") redirectTo = "/officer";
    else if (user.role === "collector") redirectTo = "/collector";

    const res = NextResponse.json({ message: "Login successful", redirectTo, role: user.role });
    setAuthCookie(res, token);
    return res;
  } catch (err) {
    console.error("[api/auth/login]", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
