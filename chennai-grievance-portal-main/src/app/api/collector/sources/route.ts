import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { collectorSession, failed } from "@/lib/collector/guard";
import { addSource, listSources, sourceItems } from "@/lib/collector/sources";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  try {
    const id = Number(req.nextUrl.searchParams.get("items")) || 0;
    if (id) return NextResponse.json({ items: await sourceItems({ sourceId: id, limit: 60 }) });
    return NextResponse.json({ sources: await listSources() });
  } catch (err) {
    return failed(err, "the sources");
  }
}

const Body = z.object({
  name: z.string().trim().min(2).max(128),
  url: z.string().trim().url().max(500),
  kind: z.enum(["auto", "rss", "html", "json"]).default("auto"),
  auth: z.enum(["none", "basic", "form", "token"]).default("none"),
  loginUrl: z.string().trim().url().max(500).optional().nullable().or(z.literal("")),
  userField: z.string().trim().max(64).optional().nullable(),
  passField: z.string().trim().max(64).optional().nullable(),
  username: z.string().trim().max(255).optional().nullable(),
  secret: z.string().max(2000).optional().nullable(),
  refreshMinutes: z.number().int().min(15).max(1440).default(1440),
  authorized: z.literal(true, { errorMap: () => ({ message: "Confirm that you are authorized to use this source." }) })
});

/** Add a source by link; credentials are stored encrypted and used only for this source's own login. */
export async function POST(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid source." }, { status: 400 });
  try {
    const d = parsed.data;
    return NextResponse.json(await addSource({ ...d, loginUrl: d.loginUrl || null }, s.email));
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") return NextResponse.json({ error: "This link is already connected." }, { status: 409 });
    if (err instanceof TypeError) return NextResponse.json({ error: "That link is not valid." }, { status: 400 });
    return failed(err, "the new source");
  }
}
