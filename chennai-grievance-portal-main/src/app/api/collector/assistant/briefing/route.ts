import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { collectorSession, failed } from "@/lib/collector/guard";
import { audit } from "@/lib/collector/sources";
import { checkRateLimit } from "@/lib/rate-limit";
import { insights } from "@/lib/collector/insights";
import { saveWorkspace } from "@/lib/collector/workspaces";

export const dynamic = "force-dynamic";

/** "Save as workspace" from a briefing answer: the console's own briefing (insights()), frozen into a workspace. Never a second briefing engine. */
export async function POST(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  if (!checkRateLimit(`assistant-briefing:${s.userId}`, 10, 60).allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const b = z.object({ period: z.enum(["daily", "weekly", "monthly", "quarterly"]).default("daily") }).safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: "Say which period." }, { status: 400 });
  try {
    const d = await insights(b.data.period, null, null);
    const name = `Briefing ${d.now.slice(0, 10)} (${b.data.period})`;
    await saveWorkspace(s.email, { name, filters: { period: b.data.period }, layout: {},
      briefing: { md: d.briefing.md, facts: d.briefing.stats as Record<string, unknown>, period: b.data.period, asOf: d.now.slice(0, 19) } });
    await audit(s.email, "assistant:save_briefing", "workspaces", name, null, { period: b.data.period });
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    return failed(err, "the briefing workspace");
  }
}
