import { NextResponse } from "next/server";
import { getActiveSession } from "@/lib/auth";
import type { JwtPayload } from "@/types";

/** The signed-in, active Collector, or a 401 response to return. */
export async function collectorSession(): Promise<JwtPayload | NextResponse> {
  const session = await getActiveSession();
  if (!session || session.role !== "collector") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return session;
}

export function failed(err: unknown, what: string) {
  console.error(`collector ${what} failed`, err);
  return NextResponse.json({ error: `Could not load ${what}.` }, { status: 500 });
}
