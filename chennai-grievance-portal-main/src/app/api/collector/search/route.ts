import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { search } from "@/lib/collector/intel";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const text = (req.nextUrl.searchParams.get("q") || "").trim().slice(0, 80);
  if (text.length < 2) return NextResponse.json({ zones: [], depts: [], incidents: [] });
  try {
    return NextResponse.json(await search(text));
  } catch (err) {
    return failed(err, "search");
  }
}
