import { NextRequest, NextResponse } from "next/server";
import { ID_RE, officerSession } from "@/lib/officer/guard";
import { WorkflowError, recordStep } from "@/lib/officer/data";
import { OFFICER } from "@/lib/officer/departments";
import { newPhotoDir, removePhotoDir, savePhotos, sniff, type PhotoExt } from "@/lib/officer/photos";

export const dynamic = "force-dynamic";

/**
 * Completion report to the Collector: remarks plus at least one photo of the finished
 * work (multipart form: `remarks`, `photos` repeated). Moves the grievance from
 * "In action" to "Sent to Collector".
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await officerSession(req.nextUrl.searchParams, { write: true });
  if (ctx instanceof NextResponse) return ctx;
  if (!ID_RE.test(params.id)) return NextResponse.json({ error: "Invalid grievance id." }, { status: 400 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the report as a form with remarks and photos." }, { status: 400 });
  const remarks = String(form.get("remarks") ?? "").trim();
  if (remarks.length < OFFICER.minRemarks) return NextResponse.json({ error: "Write remarks describing the work done." }, { status: 400 });
  if (remarks.length > OFFICER.maxRemarks) return NextResponse.json({ error: `Keep the remarks under ${OFFICER.maxRemarks} characters.` }, { status: 400 });

  const files = form.getAll("photos").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!files.length) return NextResponse.json({ error: "Attach at least one photo of the completed work." }, { status: 400 });
  if (files.length > OFFICER.maxPhotos) return NextResponse.json({ error: `Attach at most ${OFFICER.maxPhotos} photos.` }, { status: 400 });
  const photos: { buf: Buffer; ext: PhotoExt }[] = [];
  for (const f of files) {
    if (f.size > OFFICER.maxPhotoBytes) return NextResponse.json({ error: `Each photo must be ${OFFICER.maxPhotoBytes / 1024 / 1024} MB or smaller.` }, { status: 400 });
    const buf = Buffer.from(await f.arrayBuffer());
    const ext = sniff(buf);
    if (!ext) return NextResponse.json({ error: "Photos must be JPG, PNG or WebP images." }, { status: 400 });
    photos.push({ buf, ext });
  }

  const dir = newPhotoDir();
  try {
    const names = await savePhotos(dir, photos);
    const r = await recordStep(ctx.dept, params.id, "send", { email: ctx.session.email, userId: ctx.session.userId },
      { remarks, photoDir: dir, photos: names });
    return NextResponse.json(r, { status: 201 });
  } catch (err) {
    await removePhotoDir(dir).catch(() => undefined);
    if (err instanceof WorkflowError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("officer report failed", err);
    return NextResponse.json({ error: "Could not send the report." }, { status: 500 });
  }
}
