import { NextRequest, NextResponse } from "next/server";
import { failed, fresh, officerSession, parseScope } from "@/lib/officer/guard";
import { grievanceList } from "@/lib/officer/data";
import { parseTab } from "@/lib/officer/stages";
import { parseCat } from "@/lib/collector/intel";

export const dynamic = "force-dynamic";

/**
 * One page of the department's grievances in the period and area: a tab (New / In action / Sent / Verified) or,
 * with tab=all, every stage. flag=serious (severe or high, still open), flag=overdue (open, past deadline) and flag=due (open, due within 24 hours)
 * match the Collector's snapshot tiles.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const ctx = await officerSession(p);
  if (ctx instanceof NextResponse) return ctx;
  const int = (k: string, d: number) => (Number.isInteger(Number(p.get(k))) && p.get(k) !== null ? Number(p.get(k)) : d);
  const text = (p.get("q") ?? "").trim().slice(0, 80);
  const flag = p.get("flag");
  try {
    return fresh(await grievanceList(ctx.dept, {
      ...parseScope(p),
      tab: p.get("tab") === "all" ? "all" : parseTab(p.get("tab")),
      page: Math.max(0, int("page", 0)),
      per: Math.max(1, Math.min(100, int("per", 8))),
      cat: parseCat(p.get("cat")),
      q: text.length >= 2 ? text : null,
      flag: flag === "open" || flag === "serious" || flag === "overdue" || flag === "due" ? flag : null,
      sev: ["Severe", "High", "Medium", "Low"].includes(p.get("sev") ?? "") ? p.get("sev") : null
    }));
  } catch (err) {
    return failed(err, "grievances");
  }
}
