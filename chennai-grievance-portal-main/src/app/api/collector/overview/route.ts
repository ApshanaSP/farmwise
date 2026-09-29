import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { asOf, exportMeta, overview, parseCat, parseDept, parsePeriod, parseTaluk, parseZone } from "@/lib/collector/intel";
import { runDueSources } from "@/lib/collector/sources";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const p = req.nextUrl.searchParams;
  try {
    // ?meta=1: a cheap check the console polls to learn that the pipeline published new data.
    if (p.get("meta")) {
      const [now, meta] = await Promise.all([asOf(), exportMeta()]);
      return NextResponse.json({ now, exportedAt: meta.exported_at ?? null });
    }
    // Added sources whose refresh interval has passed are fetched in the background.
    runDueSources();
    return NextResponse.json(await overview(parsePeriod(p.get("period")), parseZone(p.get("zone")), parseDept(p.get("dept")),
      { cat: parseCat(p.get("cat")), taluk: parseTaluk(p.get("taluk")) }));
  } catch (err) {
    return failed(err, "the overview");
  }
}
