import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

export async function GET() {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, description FROM departments ORDER BY id ASC"
  );
  return NextResponse.json({ departments: rows });
}
