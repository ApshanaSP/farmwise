import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

export async function GET(req: NextRequest) {
  const localityId = req.nextUrl.searchParams.get("localityId");
  if (!localityId || Number.isNaN(Number(localityId))) {
    return NextResponse.json({ error: "localityId query parameter is required" }, { status: 400 });
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, locality_id, name FROM streets WHERE locality_id = ? ORDER BY name ASC",
    [Number(localityId)]
  );
  return NextResponse.json({ streets: rows });
}
