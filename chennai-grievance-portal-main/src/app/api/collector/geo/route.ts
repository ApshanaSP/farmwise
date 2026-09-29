import { NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { mapGeo } from "@/lib/collector/geo";

export const dynamic = "force-dynamic";

/** Ward and zone outlines in lat/lon for the satellite map. */
export async function GET() {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json(await mapGeo(), { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    return failed(err, "the map outlines");
  }
}
