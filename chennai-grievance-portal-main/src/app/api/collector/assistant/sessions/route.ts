import { NextResponse } from "next/server";
import { failed } from "@/lib/collector/guard";
import { assistantSession } from "@/lib/assistant/access";
import { listSessions } from "@/lib/assistant/store";

export const dynamic = "force-dynamic";

/** The Collector's recent conversations with the assistant, newest first. */
export async function GET() {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json({ sessions: await listSessions(s.email) });
  } catch (err) {
    return failed(err, "the conversations");
  }
}
