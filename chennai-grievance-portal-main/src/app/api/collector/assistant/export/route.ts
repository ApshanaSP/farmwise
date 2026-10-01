import { NextRequest, NextResponse } from "next/server";
import { failed } from "@/lib/collector/guard";
import { assistantSession } from "@/lib/assistant/access";
import { audit } from "@/lib/collector/sources";
import { exportRows, parseDept, parsePeriod, parseZone } from "@/lib/collector/intel";
import { LIMITS, admitExport } from "@/lib/assistant/limits";

export const dynamic = "force-dynamic";

/**
 * CSV offered by an answer: the console's own export rows (incident-level, no personal
 * data), capped at 1,000 rows and 10 downloads a day per Collector, and audited.
 */
export async function GET(req: NextRequest) {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  if (!admitExport(String(s.userId))) return NextResponse.json({ error: `Only ${LIMITS.exportsPerDay} exports a day from the assistant.` }, { status: 429 });
  const p = req.nextUrl.searchParams;
  const period = parsePeriod(p.get("period")), zone = parseZone(p.get("zone")), dept = s.lockDept ?? parseDept(p.get("dept"));
  try {
    const all = await exportRows(period, zone, dept);
    const rows = all.slice(0, LIMITS.exportRows);
    const cols = ["id", "event", "area", "location", "department", "severity", "status", "complaints", "reported"];
    const cell = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])).join(","))].join("\n");
    await audit(s.email, "assistant:export", "incidents", null, null, { period, zone, dept, rows: rows.length, of: all.length });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="district-iq-${period}${zone ? `-zone${zone}` : ""}${dept ? `-${dept.toLowerCase()}` : ""}.csv"` } });
  } catch (err) {
    return failed(err, "the export");
  }
}
