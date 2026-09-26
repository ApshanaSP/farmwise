import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { resolveWard, wardDataProvenance } from "@/lib/wards";

/**
 * Resolves a coordinate to a GCC ward and zone by point-in-polygon, and
 * answers the service-eligibility question at the same time: a point outside
 * every ward polygon is outside the municipal area.
 *
 * The three outcomes are distinct on purpose, so the form can say which one
 * happened instead of collapsing them into "ward unknown":
 *   resolved          - inside a ward; safe to autofill
 *   outside_boundary  - verifiably not a GCC location
 *   unavailable       - boundary data is not installed; nothing can be claimed
 */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "lat and lng query parameters are required" },
      { status: 400 }
    );
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "Coordinates are out of range" }, { status: 400 });
  }

  const lookup = resolveWard(lat, lng);
  const provenance = wardDataProvenance();

  if (lookup.status === "unavailable") {
    return NextResponse.json({
      status: "unavailable",
      message: lookup.message,
      serviceable: null,
      provenance
    });
  }

  if (lookup.status === "outside_boundary") {
    return NextResponse.json({
      status: "outside_boundary",
      message: lookup.message,
      serviceable: false,
      provenance
    });
  }

  // Map the ward's zone back onto this application's zones table.
  const [zoneRows] = await pool.query<RowDataPacket[]>(
    `SELECT z.id, z.zone_number, z.zone_name
       FROM zone_wards zw JOIN zones z ON z.id = zw.zone_id
      WHERE zw.ward_number = ? LIMIT 1`,
    [lookup.wardNo]
  );
  const zone = zoneRows[0];

  return NextResponse.json({
    status: "resolved",
    serviceable: true,
    wardNumber: lookup.wardNo,
    zoneId: zone ? (zone.id as number) : null,
    zoneNumber: zone ? (zone.zone_number as number) : lookup.zoneNumber,
    zoneName: zone ? (zone.zone_name as string) : lookup.zoneName,
    // True when the boundary data itself has overlapping polygons for this
    // point; the form asks the citizen to confirm rather than silently picking.
    ambiguous: lookup.ambiguous,
    candidateWards: lookup.candidates ?? null,
    provenance
  });
}
