import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { z } from "zod";
import intelPool, { ops } from "@/lib/collector/db";
import { collectorSession, failed } from "@/lib/collector/guard";
import { audit, ingest, sourceItems } from "@/lib/collector/sources";

export const dynamic = "force-dynamic";

const Body = z.object({
  file: z.string().max(200),
  publisher: z.string().trim().max(120).optional().nullable(),
  date: z.string().max(10).optional().nullable(),
  blocks: z.array(z.string().max(8000)).min(1).max(80)
});

/**
 * Text read (in the browser, with OCR) from an uploaded newspaper page. Each block is
 * one article whose first line is the headline; blocks are classified and placed like
 * any other source item.
 */
export async function POST(req: NextRequest) {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: b.error.issues[0]?.message ?? "Nothing to read." }, { status: 400 });
  try {
    const [[src]] = await intelPool.query<RowDataPacket[]>(`SELECT source_id FROM ${ops("sources")} WHERE kind = 'ocr' LIMIT 1`);
    if (!src) return NextResponse.json({ error: "Run npm run setup:ops first." }, { status: 500 });
    const items = b.data.blocks
      .map((t) => t.replace(/[ \t]+\n/g, "\n").trim())
      .filter((t) => t.length > 40)
      .map((t) => {
        const [first, ...rest] = t.split("\n");
        return {
          title: `${b.data.publisher ? b.data.publisher + ": " : ""}${first.trim()}`.slice(0, 300),
          body: rest.join(" ").trim() || t,
          url: `upload://${b.data.file}`,
          published: b.data.date || null
        };
      });
    const added = await ingest(src.source_id, items, "ocr");
    await intelPool.query(
      `UPDATE ${ops("sources")} SET items_total = items_total + ?, last_run_at = NOW(), last_ok_at = NOW(), status = 'ok' WHERE source_id = ?`,
      [added, src.source_id]
    );
    await audit(s.email, "source:ocr", "source_items", src.source_id, null, { file: b.data.file, blocks: b.data.blocks.length, added });
    const recent = await sourceItems({ sourceId: src.source_id, limit: Math.max(10, items.length) });
    return NextResponse.json({ added, read: items.length, items: recent.slice(0, Math.max(10, items.length)) });
  } catch (err) {
    return failed(err, "the newspaper page");
  }
}
