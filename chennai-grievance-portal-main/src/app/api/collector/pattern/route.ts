import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { parseCat, parseZone } from "@/lib/collector/intel";
import { pattern } from "@/lib/collector/insights";

export const dynamic = "force-dynamic";

/** One unusual spike (category, zone, day), recurring hotspot (id) or category trend (cat), with the incidents behind it. */
export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const p = req.nextUrl.searchParams;
  try {
    const kind = p.get("kind");
    const date = p.get("date") ?? "";
    const cat = parseCat(p.get("cat"));
    const id = p.get("id") ?? "";
    const r = kind === "spike" && cat && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? await pattern({ kind: "spike", cat, zone: parseZone(p.get("zone")), date })
      : kind === "hotspot" && /^[A-Z0-9_-]{3,64}$/.test(id) ? await pattern({ kind: "hotspot", id })
        : kind === "category" && cat ? await pattern({ kind: "category", cat }) : undefined;
    if (r === undefined) return NextResponse.json({ error: "Unknown pattern." }, { status: 400 });
    if (!r) return NextResponse.json({ error: "This hotspot is no longer in the store." }, { status: 404 });
    return NextResponse.json(r);
  } catch (err) {
    return failed(err, "the pattern");
  }
}
