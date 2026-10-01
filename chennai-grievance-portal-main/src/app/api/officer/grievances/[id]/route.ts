import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ID_RE, failed, fresh, officerSession } from "@/lib/officer/guard";
import { WorkflowError, grievanceDetail, recordStep } from "@/lib/officer/data";

export const dynamic = "force-dynamic";

/** One grievance of the officer's department (404 for any other department's). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await officerSession(req.nextUrl.searchParams);
  if (ctx instanceof NextResponse) return ctx;
  if (!ID_RE.test(params.id)) return NextResponse.json({ error: "Invalid grievance id." }, { status: 400 });
  try {
    const d = await grievanceDetail(ctx.dept, params.id);
    if (!d) return NextResponse.json({ error: "Grievance not found in your department." }, { status: 404 });
    return fresh(d);
  } catch (err) {
    return failed(err, "the grievance");
  }
}

const StepSchema = z.object({ step: z.literal("approve") });

/** Approve a new grievance (it moves to In action). Sending to the Collector is POST .../report. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await officerSession(req.nextUrl.searchParams, { write: true });
  if (ctx instanceof NextResponse) return ctx;
  if (!ID_RE.test(params.id)) return NextResponse.json({ error: "Invalid grievance id." }, { status: 400 });
  const parsed = StepSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  try {
    const r = await recordStep(ctx.dept, params.id, parsed.data.step, { email: ctx.session.email, userId: ctx.session.userId });
    return fresh(r, 201);
  } catch (err) {
    if (err instanceof WorkflowError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("officer step failed", err);
    return NextResponse.json({ error: "Could not save the step." }, { status: 500 });
  }
}
