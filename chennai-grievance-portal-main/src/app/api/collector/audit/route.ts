import { NextResponse } from "next/server";
import { collectorSession, failed } from "@/lib/collector/guard";
import { auditLog } from "@/lib/collector/workspaces";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await collectorSession();
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json({ log: await auditLog() });
  } catch (err) {
    return failed(err, "the audit log");
  }
}
