import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validators";
import { RowDataPacket } from "mysql2";
import { UserRow } from "@/types";

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM users WHERE id = ?", [session.userId]);
  if (rows.length === 0) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }
  const user = rows[0] as UserRow;

  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, session.userId]);

  return NextResponse.json({ message: "Password changed successfully." });
}
