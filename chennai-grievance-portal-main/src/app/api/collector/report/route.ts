import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { parseCat, parseDept, parsePeriod, parseTaluk, parseZone, report } from "@/lib/collector/intel";

export const dynamic = "force-dynamic";

/** Data for the Collector's PDF report (drawn in the browser). */
export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const p = req.nextUrl.searchParams;
  try {
    return NextResponse.json(await report(parsePeriod(p.get("period")), parseZone(p.get("zone")), parseDept(p.get("dept")),
      { cat: parseCat(p.get("cat")), taluk: parseTaluk(p.get("taluk")) }));
  } catch (err) {
    return failed(err, "the report");
  }
}
