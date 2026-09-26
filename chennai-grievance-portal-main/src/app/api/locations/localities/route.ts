import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

export async function GET(req: NextRequest) {
  const zoneId = req.nextUrl.searchParams.get("zoneId");
  if (!zoneId || Number.isNaN(Number(zoneId))) {
    return NextResponse.json({ error: "zoneId query parameter is required" }, { status: 400 });
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, zone_id, name FROM localities WHERE zone_id = ? ORDER BY name ASC",
    [Number(zoneId)]
  );
  return NextResponse.json({ localities: rows });
}
