import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

/**
 * Streets, by `zoneId` (what the complaint form uses), or by `areaId` /
 * `localityId`.
 *
 * Each street carries its locality and area names, shown as a secondary line,
 * because street names repeat heavily across Chennai ("1ST STREET" exists in
 * dozens of localities) and the citizen needs to tell them apart.
 *
 * Coverage note: streets hang off GCC's PGR "areas", and 67 of the 250 areas
 * could not be placed in a zone, so their streets do not appear under any
 * zone. That is why manual street entry is always offered.
 */
export async function GET(req: NextRequest) {
  const zoneId = Number(req.nextUrl.searchParams.get("zoneId")) || null;
  const areaId = Number(req.nextUrl.searchParams.get("areaId")) || null;
  const localityId = Number(req.nextUrl.searchParams.get("localityId")) || null;

  if (!zoneId && !areaId && !localityId) {
    return NextResponse.json(
      { error: "Provide zoneId, areaId or localityId" },
      { status: 400 }
    );
  }

  const base = `
    SELECT s.id, s.gcc_id, s.name, s.locality_id,
           l.name AS locality_name, a.name AS area_name
      FROM gcc_streets s
      JOIN gcc_localities l ON l.id = s.locality_id
      JOIN gcc_areas a ON a.id = l.area_id`;

  const [rows] = localityId
    ? await pool.query<RowDataPacket[]>(base + " WHERE s.locality_id = ? ORDER BY s.name ASC", [localityId])
    : areaId
    ? await pool.query<RowDataPacket[]>(base + " WHERE l.area_id = ? ORDER BY s.name ASC", [areaId])
    : await pool.query<RowDataPacket[]>(base + " WHERE a.zone_id = ? ORDER BY s.name ASC", [zoneId]);

  return NextResponse.json({
    streets: rows.map((r) => ({
      id: r.id as number,
      gcc_id: r.gcc_id as number,
      name: r.name as string,
      locality_id: r.locality_id as number,
      locality_name: r.locality_name as string,
      area_name: r.area_name as string
    })),
    allowManualEntry: true
  });
}
