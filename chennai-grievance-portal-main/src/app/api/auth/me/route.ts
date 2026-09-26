import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.email, u.role, u.department_id, d.name AS department_name,
            p.first_name, p.last_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE u.id = ?`,
    [session.userId]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user: rows[0] });
}
