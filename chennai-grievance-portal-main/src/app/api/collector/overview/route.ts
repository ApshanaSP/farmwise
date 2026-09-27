import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { asOf, exportMeta, overview, parseDept, parsePeriod, parseZone } from "@/lib/collector/intel";

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
    return NextResponse.json(await overview(parsePeriod(p.get("period")), parseZone(p.get("zone")), parseDept(p.get("dept"))));
  } catch (err) {
    return failed(err, "the overview");
  }
}
