import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { collectorSession, failed } from "@/lib/collector/guard";
import { audit } from "@/lib/collector/sources";
import { checkRateLimit } from "@/lib/rate-limit";
import { loadCatalog, renderCatalog } from "@/lib/assistant/catalog";
import { ToolError, listTools, runTool } from "@/lib/assistant/tools";

export const dynamic = "force-dynamic";

/**
 * Developer view of the assistant's tools and data catalog. GET lists the tools, the
 * catalog and any drift between the catalog and the live schema (?render=1 adds the
 * planner's text); POST { tool, args } runs one tool with validated arguments. Used to
 * check that tool numbers equal the console's, and by the golden-set harness.
 * Off in production unless ASSISTANT_TOOLS_API=1.
 */
const enabled = () => process.env.NODE_ENV !== "production" || process.env.ASSISTANT_TOOLS_API === "1";

export async function GET(req: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  try {
    const cat = await loadCatalog();
    const tables = [...cat.tables.values()].map((t) => ({ name: t.name, db: t.db, kind: t.kind, columns: t.columns.size, time: t.time ?? null,
      cap: t.cap, test: t.test }));
    const body: Record<string, unknown> = { tools: listTools(), catalog: { source: cat.source, tables, drift: cat.drift } };
    if (req.nextUrl.searchParams.get("render")) body.rendered = renderCatalog(cat);
    return NextResponse.json(body);
  } catch (err) {
    return failed(err, "the assistant tools");
  }
}

const RunSchema = z.object({ tool: z.string().regex(/^[a-z_]{2,40}$/), args: z.record(z.unknown()).default({}) });

export async function POST(req: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const rl = checkRateLimit(`assistant-tools:${s.userId}`, 120, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 60) } });
  }
  const parsed = RunSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { tool, args }." }, { status: 400 });
  const requestId = crypto.randomUUID();
  const t0 = Date.now();
  try {
    const result = await runTool(parsed.data.tool, parsed.data.args);
    const ms = Date.now() - t0;
    await audit(s.email, "assistant:tool", "assistant", requestId, null, { tool: result.tool, args: result.args, ms });
    return NextResponse.json({ requestId, ms, result });
  } catch (err) {
    if (err instanceof ToolError) return NextResponse.json({ requestId, error: err.message }, { status: 400 });
    return failed(err, "the assistant tool");
  }
}
