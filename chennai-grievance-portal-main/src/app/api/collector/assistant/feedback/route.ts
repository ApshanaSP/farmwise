import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assistantSession } from "@/lib/assistant/access";
import { audit } from "@/lib/collector/sources";
import { checkRateLimit } from "@/lib/rate-limit";
import { saveFeedback } from "@/lib/assistant/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  messageId: z.string().regex(/^[0-9a-f-]{36}$/).nullable().optional(),
  insightKey: z.string().max(128).nullable().optional(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(500).nullable().optional()
}).refine((b) => !!b.messageId || !!b.insightKey, { message: "Say which answer or insight." });

/** Helpful / not helpful on an answer or an insight; used to rank insights. */
export async function POST(req: NextRequest) {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  if (!checkRateLimit(`assistant-feedback:${s.userId}`, 60, 60).allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid feedback." }, { status: 400 });
  const ok = await saveFeedback(s.email, { ...parsed.data, rating: parsed.data.rating });
  await audit(s.email, "assistant:feedback", "assistant_feedback", parsed.data.messageId ?? parsed.data.insightKey ?? null, null, { rating: parsed.data.rating });
  return NextResponse.json({ ok });
}
