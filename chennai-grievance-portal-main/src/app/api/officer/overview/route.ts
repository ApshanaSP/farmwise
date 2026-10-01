import { NextRequest, NextResponse } from "next/server";
import { failed, fresh, officerSession, parseScope } from "@/lib/officer/guard";
import { officerOverview, officerPulse } from "@/lib/officer/data";

export const dynamic = "force-dynamic";

/** Everything the officer console's first screen shows, for the signed-in officer's department (or ?dept= for the Collector). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const ctx = await officerSession(p);
  if (ctx instanceof NextResponse) return ctx;
  try {
    // ?meta=1: the cheap check the console polls for new grievances, decisions and a new pipeline build
    if (p.get("meta")) return fresh(await officerPulse(ctx.dept));
    return fresh(await officerOverview(ctx.dept, parseScope(p)));
  } catch (err) {
    return failed(err, "the dashboard");
  }
}
