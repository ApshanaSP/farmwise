import { NextRequest, NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { removeSource, runSource, updateSource } from "@/lib/collector/sources";

export const dynamic = "force-dynamic";

/** POST: run the source now. PATCH: pause/resume or change the refresh interval. DELETE: remove an added source. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json(await runSource(Number(params.id), s.email));
  } catch (err: any) {
    if (/not found/i.test(err?.message)) return NextResponse.json({ error: err.message }, { status: 404 });
    return failed(err, "the source run");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const b = await req.json().catch(() => ({}));
  try {
    await updateSource(Number(params.id), { enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      refreshMinutes: Number(b.refreshMinutes) || undefined }, s.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failed(err, "the source");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  try {
    await removeSource(Number(params.id), s.email);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (/built-in|not found/i.test(err?.message)) return NextResponse.json({ error: err.message }, { status: 400 });
    return failed(err, "the source");
  }
}
