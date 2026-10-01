import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assistantSession } from "@/lib/assistant/access";
import { audit } from "@/lib/collector/sources";
import { checkRateLimit } from "@/lib/rate-limit";
import { addPin, deletePin, listPins } from "@/lib/assistant/store";

export const dynamic = "force-dynamic";

/** Pinned answers: question, tools and chart design (not numbers), re-run on fresh data when opened. */
export async function GET() {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ pins: await listPins(s.email) });
}

export async function POST(req: NextRequest) {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  if (!checkRateLimit(`assistant-pins:${s.userId}`, 30, 60).allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const parsed = z.object({ messageId: z.string().regex(/^[0-9a-f-]{36}$/) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say which answer to pin." }, { status: 400 });
  const id = await addPin(s.email, parsed.data.messageId);
  if (id == null) return NextResponse.json({ error: "That answer could not be pinned." }, { status: 404 });
  await audit(s.email, "assistant:pin", "assistant_pins", String(id), null, { messageId: parsed.data.messageId });
  return NextResponse.json({ id });
}

export async function DELETE(req: NextRequest) {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Say which pin." }, { status: 400 });
  const ok = await deletePin(s.email, id);
  if (ok) await audit(s.email, "assistant:unpin", "assistant_pins", String(id), null, {});
  return NextResponse.json({ ok });
}
