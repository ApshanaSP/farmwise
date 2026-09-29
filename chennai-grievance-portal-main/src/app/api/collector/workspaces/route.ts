import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { collectorSession, failed } from "@/lib/collector/guard";
import { listWorkspaces, saveWorkspace } from "@/lib/collector/workspaces";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json({ workspaces: await listWorkspaces(s.email) });
  } catch (err) {
    return failed(err, "the workspaces");
  }
}

const Body = z.object({
  name: z.string().trim().min(2).max(100),
  filters: z.record(z.any()),
  layout: z.record(z.any()),
  briefing: z.object({ md: z.string().max(200_000), facts: z.record(z.any()), period: z.string().max(16), asOf: z.string().max(19) }).optional()
});

/** Save the current dashboard as a new version of a named workspace, with a frozen copy of the briefing. */
export async function POST(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: b.error.issues[0]?.message ?? "Invalid workspace." }, { status: 400 });
  try {
    return NextResponse.json(await saveWorkspace(s.email, b.data));
  } catch (err) {
    return failed(err, "the workspace");
  }
}
