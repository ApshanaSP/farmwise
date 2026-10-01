import { NextResponse } from "next/server";
import { failed } from "@/lib/collector/guard";
import { assistantSession } from "@/lib/assistant/access";
import { asOf } from "@/lib/collector/intel";
import { aiStatus } from "@/lib/ai/gateway";
import { readOnlyMode } from "@/lib/assistant/compile";
import { feeds } from "@/lib/assistant/queries";
import { embedStatus, warmUp } from "@/lib/assistant/embed";

export const dynamic = "force-dynamic";

/** What the dialog's header shows: data freshness, feeds, and whether the AI provider is available (never the keys). */
export async function GET() {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  try {
    const [now, f] = await Promise.all([asOf(), feeds()]);
    const ai = aiStatus();
    // the dialog is opening: get the meaning-search index ready before the first question (in the background)
    warmUp(now);
    return NextResponse.json({
      asOf: now, exportedAt: f.exportedAt, feeds: f.rows.map((r) => ({ source: r.source, status: r.status, newest: r.newest })),
      feedsOk: f.rows.filter((r) => r.status === "ok").length, feedsTotal: f.rows.length,
      ai: { available: ai.available, problem: ai.problem, providers: ai.providers.map((p) => p.name) }, readOnly: readOnlyMode(), search: embedStatus()
    });
  } catch (err) {
    return failed(err, "the assistant status");
  }
}
