import { NextResponse } from "next/server";
import { failed } from "@/lib/collector/guard";
import { assistantSession } from "@/lib/assistant/access";
import { checkRateLimit } from "@/lib/rate-limit";
import { todayInsights } from "@/lib/assistant/insightcards";

export const dynamic = "force-dynamic";

/** Today's top insights for the pop-up's chips and the launcher badge (from the console's insights(), ranked with feedback); an officer's are their department's. */
export async function GET() {
  const s = await assistantSession();
  if (s instanceof NextResponse) return s;
  if (!checkRateLimit(`assistant-insights:${s.userId}`, 30, 60).allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    const items = await todayInsights(s.email, 5, s.lockDept);
    return NextResponse.json({ items: items.map(({ tools: _t, ...x }) => x) });
  } catch (err) {
    return failed(err, "today's insights");
  }
}
