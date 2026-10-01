import { NextRequest, NextResponse } from "next/server";
import { failed, officerSession } from "@/lib/officer/guard";
import { mapGeo } from "@/lib/collector/geo";

export const dynamic = "force-dynamic";

/** Ward polygons and zone outlines for the grievance map (the same shapes the Collector console uses). */
export async function GET(req: NextRequest) {
  const ctx = await officerSession(req.nextUrl.searchParams);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json(await mapGeo(), { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    return failed(err, "the map");
  }
}
