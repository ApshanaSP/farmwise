import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { openWorkspace } from "@/lib/collector/workspaces";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  try {
    const w = await openWorkspace(s.email, Number(params.id));
    return w ? NextResponse.json(w) : NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  } catch (err) {
    return failed(err, "the workspace");
  }
}
