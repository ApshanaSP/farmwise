import { NextRequest, NextResponse } from "next/server";
import { failed, fresh, officerSession } from "@/lib/officer/guard";
import { search } from "@/lib/officer/data";

export const dynamic = "force-dynamic";

/** Search the department's grievances by title, street, area, type or id. */
export async function GET(req: NextRequest) {
  const ctx = await officerSession(req.nextUrl.searchParams);
  if (ctx instanceof NextResponse) return ctx;
  const text = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (text.length < 2) return fresh({ rows: [] });
  try {
    return fresh({ rows: await search(ctx.dept, text) });
  } catch (err) {
    return failed(err, "search results");
  }
}
