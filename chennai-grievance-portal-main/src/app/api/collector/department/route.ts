import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { department, parseDept, parsePeriod, parseZone } from "@/lib/collector/intel";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const p = req.nextUrl.searchParams;
  const code = parseDept(p.get("code"));
  if (!code) return NextResponse.json({ error: "Unknown department." }, { status: 400 });
  try {
    const d = await department(code, parsePeriod(p.get("period")), parseZone(p.get("zone")));
    return d ? NextResponse.json(d) : NextResponse.json({ error: "Unknown department." }, { status: 404 });
  } catch (err) {
    return failed(err, "the department");
  }
}
