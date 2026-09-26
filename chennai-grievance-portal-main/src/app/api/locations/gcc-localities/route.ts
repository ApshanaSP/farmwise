import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

/** Localities within a GCC area. */
export async function GET(req: NextRequest) {
  const areaId = Number(req.nextUrl.searchParams.get("areaId"));
  if (!areaId || Number.isNaN(areaId)) {
    return NextResponse.json({ error: "areaId query parameter is required" }, { status: 400 });
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, gcc_id, name, area_id FROM gcc_localities WHERE area_id = ? ORDER BY name ASC",
    [areaId]
  );
  return NextResponse.json({ localities: rows });
}
