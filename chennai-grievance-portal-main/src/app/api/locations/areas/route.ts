import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

/** Verified GCC areas (adminBndry1 on the GCC PGR site). */
export async function GET() {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, gcc_id, name FROM gcc_areas ORDER BY name ASC"
  );
  const [[src]] = await pool.query<RowDataPacket[]>(
    "SELECT source_url, source_label, fetched_at FROM reference_data_sources WHERE dataset = 'gcc_areas_localities'"
  );
  return NextResponse.json({ areas: rows, source: src ?? null });
}
