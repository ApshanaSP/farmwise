import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { parseCat, parseDept, parsePeriod, parseTaluk, parseZone } from "@/lib/collector/intel";
import { insights } from "@/lib/collector/insights";

export const dynamic = "force-dynamic";

/** Briefing, department follow-ups, news-only incidents, trends, taluks, patterns and markets for the scope. */
export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const p = req.nextUrl.searchParams;
  try {
    return NextResponse.json(await insights(parsePeriod(p.get("period")), parseZone(p.get("zone")), parseDept(p.get("dept")),
      { cat: parseCat(p.get("cat")), taluk: parseTaluk(p.get("taluk")) }));
  } catch (err) {
    return failed(err, "the briefing");
  }
}
