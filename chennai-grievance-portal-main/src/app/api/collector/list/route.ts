import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { list, parseCat, parseDept, parsePeriod, parseTaluk, parseZone } from "@/lib/collector/intel";

export const dynamic = "force-dynamic";

const SEVS = ["Severe", "High", "Medium", "Low"];
const STATUSES = ["open", "awaiting", "unverified", "verified", "critical", "Open", "Under review", "Assigned", "In progress",
  "Awaiting verification", "Resolved", "Rejected", "Lapsed"];

export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const p = req.nextUrl.searchParams;
  const sort = p.get("sort");
  const sev = p.get("sev");
  const status = p.get("status");
  try {
    return NextResponse.json(
      await list({
        period: parsePeriod(p.get("period")),
        zone: parseZone(p.get("zone")),
        dept: parseDept(p.get("dept")),
        sev: sev && SEVS.includes(sev) ? sev : null,
        cat: parseCat(p.get("cat")),
        taluk: parseTaluk(p.get("taluk")),
        status: status && STATUSES.includes(status) ? status : null,
        q: (p.get("q") || "").trim().slice(0, 80) || null,
        sort: sort === "sev" || sort === "c" || sort === "r" || sort === "d" ? sort : "t",
        dir: p.get("dir") === "1" ? 1 : -1,
        page: Math.max(0, Math.min(10_000, Number(p.get("page")) || 0)),
        scope: p.get("scope") === "all" ? "all" : p.get("scope") === "30d" ? "30d" : "period"
      })
    );
  } catch (err) {
    return failed(err, "the list");
  }
}
