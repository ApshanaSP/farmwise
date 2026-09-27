import { NextRequest, NextResponse } from "next/server";
import { getActiveSession } from "@/lib/auth";
import { getIncident } from "@/lib/collector/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getActiveSession();
  if (!session || session.role !== "collector") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) {
    return NextResponse.json({ error: "Invalid incident id." }, { status: 400 });
  }

  const detail = await getIncident(params.id);
  if (!detail) {
    return NextResponse.json({ error: "Incident not found." }, { status: 404 });
  }
  return NextResponse.json(detail);
}
