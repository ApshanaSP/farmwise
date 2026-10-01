import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { exportRows, parseCat, parseDept, parsePeriod, parseTaluk, parseZone } from "@/lib/collector/intel";

export const dynamic = "force-dynamic";

// the Collector's action list: incidents that need them, then closed work to check (see exportRows)
const COLS = ["list", "id", "what", "where", "department", "severity", "why", "reported", "past_deadline", "complaints"];

export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const p = req.nextUrl.searchParams;
  try {
    const rows = await exportRows(parsePeriod(p.get("period")), parseZone(p.get("zone")), parseDept(p.get("dept")),
      { cat: parseCat(p.get("cat")), taluk: parseTaluk(p.get("taluk")) });
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [COLS.join(","), ...rows.map((r: Record<string, unknown>) => COLS.map((c) => cell(r[c])).join(","))].join("\n");
    return NextResponse.json({ csv, count: rows.length });
  } catch (err) {
    return failed(err, "the export");
  }
}
