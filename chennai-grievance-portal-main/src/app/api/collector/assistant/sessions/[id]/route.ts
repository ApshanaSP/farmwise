import { NextResponse } from "next/server";
import { failed } from "@/lib/collector/guard";
import { assistantSession } from "@/lib/assistant/access";
import { sessionMessages } from "@/lib/assistant/store";

export const dynamic = "force-dynamic";

/** One conversation's messages and answer cards, for reopening it. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
  try {
    const messages = await sessionMessages(s.email, params.id);
    if (!messages) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    return NextResponse.json({ id: params.id, messages });
  } catch (err) {
    return failed(err, "the conversation");
  }
}
