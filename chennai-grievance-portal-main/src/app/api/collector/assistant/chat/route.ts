import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assistantSession } from "@/lib/assistant/access";
import { admit, LIMITS } from "@/lib/assistant/limits";
import { ask, type Stage } from "@/lib/assistant/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  sessionId: z.string().max(64).nullable().optional(),
  message: z.string().trim().min(1).max(LIMITS.messageChars),
  inputMode: z.enum(["text", "voice"]).default("text"),
  language: z.enum(["auto", "en", "ta", "tanglish"]).default("auto"),
  consoleScope: z.object({
    period: z.enum(["daily", "weekly", "monthly", "quarterly"]).catch("daily"),
    zone: z.number().int().min(1).max(15).nullable().catch(null),
    dept: z.string().regex(/^[A-Z0-9-]{2,20}$/).nullable().catch(null),
    cat: z.string().regex(/^[A-Z_]{3,40}$/).nullable().catch(null),
    taluk: z.string().regex(/^TLK-[A-Z]{3}$/).nullable().catch(null)
  }).default({ period: "daily", zone: null, dept: null, cat: null, taluk: null }),
  replyTo: z.string().max(64).nullable().optional(),
  /** re-run a pinned answer on the latest data */
  pinId: z.number().int().positive().nullable().optional(),
  /** open one of today's insights as a card */
  insightKey: z.string().max(160).nullable().optional()
});

/**
 * Ask District IQ: one question in, a stream of server-sent events out
 * (status {stage} ... answer {card} ... done {sessionId, messageId}, or error {error}).
 * A new question from the same Collector cancels the one still running. A department officer's
 * questions are answered for their own department only (lockDept).
 */
export async function POST(req: NextRequest) {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { message, consoleScope }." }, { status: 400 });
  const gate = admit(String(s.userId));
  if (!gate.ok) {
    const msg = gate.reason === "day" ? "Today's question limit is reached." : `Too many questions in a minute. Try again in ${gate.retryAfter} s.`;
    return NextResponse.json({ error: msg, retryAfter: gate.retryAfter }, { status: 429, headers: { "Retry-After": String(gate.retryAfter ?? 60) } });
  }
  const b = parsed.data;
  const requestId = crypto.randomUUID();
  const signal = AbortSignal.any([gate.signal!, req.signal]);
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { open = false; }
      };
      try {
        send("status", { stage: "understanding", requestId });
        const out = await ask({
          user: s.email, sessionId: b.sessionId ?? null, message: b.message, inputMode: b.inputMode, language: b.language, scope: b.consoleScope,
          replyTo: b.replyTo ?? null, pinId: b.pinId ?? null, insightKey: b.insightKey ?? null, lockDept: s.lockDept, signal, stage: (stage: Stage) => send("status", { stage })
        });
        send("answer", { ...out.card, sessionId: out.sessionId });
        send("done", { sessionId: out.sessionId, messageId: out.messageId, requestId });
      } catch (e) {
        if (signal.aborted) send("error", { error: "Cancelled: a newer question replaced this one.", cancelled: true, requestId });
        else {
          console.error("assistant chat failed", requestId, e);
          send("error", { error: "Something went wrong while answering. Please try again.", requestId });
        }
      } finally {
        gate.release?.();
        open = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    }
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no",
      "X-Request-Id": requestId }
  });
}
