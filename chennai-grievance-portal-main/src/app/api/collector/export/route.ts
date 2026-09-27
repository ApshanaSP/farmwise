import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { exportRows, parseDept, parsePeriod, parseZone } from "@/lib/collector/intel";

export const dynamic = "force-dynamic";

const COLS = ["id", "event", "area", "location", "department", "severity", "status", "complaints", "reported"];

export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const p = req.nextUrl.searchParams;
  try {
    const rows = await exportRows(parsePeriod(p.get("period")), parseZone(p.get("zone")), parseDept(p.get("dept")));
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [COLS.join(","), ...rows.map((r) => COLS.map((c) => cell(r[c])).join(","))].join("\n");
    return NextResponse.json({ csv, count: rows.length });
  } catch (err) {
    return failed(err, "the export");
  }
}
