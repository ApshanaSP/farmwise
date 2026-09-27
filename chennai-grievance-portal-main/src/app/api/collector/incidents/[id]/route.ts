import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { incident } from "@/lib/collector/intel";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) {
    return NextResponse.json({ error: "Invalid incident id." }, { status: 400 });
  }
  try {
    const d = await incident(params.id);
    return d ? NextResponse.json(d) : NextResponse.json({ error: "Incident not found." }, { status: 404 });
  } catch (err) {
    return failed(err, "the incident");
  }
}
