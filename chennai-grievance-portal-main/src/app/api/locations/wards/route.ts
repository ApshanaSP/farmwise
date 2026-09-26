import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

/**
 * Wards the citizen may choose from.
 *
 * With `?zoneId=`, the list is the wards of that zone. Unlike the old
 * area-based filter, this mapping is EXACT: `zone_wards` holds one row per GCC
 * ward, derived from the ward boundary polygons themselves, so a zone's wards
 * are a fact rather than an estimate.
 *
 * Labels are "Ward N" with the zone as a secondary line. GCC publishes no
 * official name per ward, so none is invented.
 */
export async function GET(req: NextRequest) {
  const zoneId = Number(req.nextUrl.searchParams.get("zoneId")) || null;

  const [rows] = zoneId
    ? await pool.query<RowDataPacket[]>(
        `SELECT zw.ward_number, zw.zone_id, z.zone_number, z.zone_name
           FROM zone_wards zw JOIN zones z ON z.id = zw.zone_id
          WHERE zw.zone_id = ? ORDER BY zw.ward_number ASC`,
        [zoneId]
      )
    : await pool.query<RowDataPacket[]>(
        `SELECT zw.ward_number, zw.zone_id, z.zone_number, z.zone_name
           FROM zone_wards zw JOIN zones z ON z.id = zw.zone_id
          ORDER BY zw.ward_number ASC`
      );

  const wards = rows.map((r) => ({
    wardNumber: r.ward_number as number,
    zoneId: r.zone_id as number,
    zoneNumber: r.zone_number as number,
    zoneName: r.zone_name as string,
    isPrimary: false,
    label: `Ward ${r.ward_number}`,
    zoneLabel: r.zone_name as string
  }));

  return NextResponse.json({
    wards,
    filtered: Boolean(zoneId),
    confidence: zoneId ? "verified" : null,
    totalWards: 200,
    notice: zoneId
      ? null
      : "Select a zone first, or place a pin on the map, to narrow this to the wards of one zone.",
    suggestedWard: null
  });
}
