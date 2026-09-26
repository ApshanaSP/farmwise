import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

export async function GET() {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, zone_number, zone_name, ward_start, ward_end FROM zones ORDER BY zone_number ASC"
  );
  return NextResponse.json({ zones: rows });
}
