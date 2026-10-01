import { NextRequest, NextResponse } from "next/server";
import { failed, fresh, officerSession, parseScope } from "@/lib/officer/guard";
import { deptInsights } from "@/lib/officer/insights";

export const dynamic = "force-dynamic";

/** Insights for the department from the district intelligence store (police, hospital, PWD, weather, air, markets ...). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const ctx = await officerSession(p);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return fresh({ modules: await deptInsights(ctx.dept.code, parseScope(p)) });
  } catch (err) {
    return failed(err, "department insights");
  }
}
