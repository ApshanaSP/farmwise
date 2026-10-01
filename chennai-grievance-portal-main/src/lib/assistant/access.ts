/**
 * Who may ask District IQ, and what they may see. The Collector asks about the whole
 * district (the console's filters only narrow it). A department officer asks from their
 * own console and is locked to their department: every tool runs with that department as
 * its filter, whatever the question says. The department comes from the database
 * (officerDeptCode), never from the request.
 */
import { NextResponse } from "next/server";
import { getActiveSession } from "@/lib/auth";
import { officerDeptCode } from "@/lib/officer/guard";

export interface AssistantUser {
  email: string;
  userId: number;
  role: "collector" | "department_officer";
  /** the officer's department: the only one the assistant answers about; null for the Collector */
  lockDept: string | null;
}

/** The signed-in Collector or department officer, or the response to return. */
export async function assistantSession(): Promise<AssistantUser | NextResponse> {
  const s = await getActiveSession();
  if (!s || (s.role !== "collector" && s.role !== "department_officer")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (s.role === "collector") return { email: s.email, userId: s.userId, role: "collector", lockDept: null };
  const dept = await officerDeptCode(s.userId);
  if (!dept) return NextResponse.json({ error: "Your account is not linked to a department." }, { status: 403 });
  return { email: s.email, userId: s.userId, role: "department_officer", lockDept: dept };
}
