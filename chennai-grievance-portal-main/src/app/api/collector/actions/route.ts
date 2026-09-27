import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { collectorSession } from "@/lib/collector/guard";

export const dynamic = "force-dynamic";

const STATUSES = ["Not started", "Pending", "In progress", "Done"] as const;

const ActionSchema = z
  .object({
    incidentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    /** An existing action (pipeline id or OPS-<n> for one added here); omit to add a new action. */
    actionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().nullable(),
    status: z.enum(STATUSES).optional().nullable(),
    text: z.string().trim().min(3).max(500).optional().nullable()
  })
  .refine((a) => (a.actionId ? !!a.status : !!a.text), { message: "Say what the action is." });

/** Action status changes and actions added by hand, kept in district_intel_ops.action_updates. */
export async function POST(req: NextRequest) {
  const session = await collectorSession();
  if (session instanceof NextResponse) return session;

  const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const a = parsed.data;

  const conn = await intelPool.getConnection();
  try {
    const [inc] = await conn.query<RowDataPacket[]>(
      "SELECT incident_id, lead_dept, officer FROM incidents WHERE incident_id = ?",
      [a.incidentId]
    );
    if (inc.length === 0) return NextResponse.json({ error: "Incident not found." }, { status: 404 });

    if (a.actionId && !a.actionId.startsWith("OPS-")) {
      const [act] = await conn.query<RowDataPacket[]>(
        "SELECT action_id FROM actions WHERE action_id = ? AND incident_id = ?",
        [a.actionId, a.incidentId]
      );
      if (act.length === 0) return NextResponse.json({ error: "Action not found." }, { status: 404 });
    }

    await conn.beginTransaction();
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO ${ops("action_updates")} (action_id, incident_id, dept_code, owner, text, status, due_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      a.actionId
        ? [a.actionId, a.incidentId, null, null, null, a.status, null, session.email]
        : [null, a.incidentId, inc[0].lead_dept, inc[0].officer || inc[0].lead_dept, a.text, "Not started",
            new Date(Date.now() + 24 * 3600 * 1000), session.email]
    );
    await conn.query(
      `INSERT INTO ${ops("audit_log")} (actor, action, table_name, record_id, before_value, after_value)
       VALUES (?, ?, 'action_updates', ?, NULL, ?)`,
      [session.email, a.actionId ? "action:status" : "action:add", a.actionId || `OPS-${res.insertId}`,
        JSON.stringify({ incident_id: a.incidentId, status: a.status ?? "Not started", text: a.text ?? null })]
    );
    await conn.commit();
    return NextResponse.json({ updateId: res.insertId, actionId: a.actionId || `OPS-${res.insertId}` }, { status: 201 });
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    console.error("collector action failed", err);
    return NextResponse.json({ error: "Could not save the action." }, { status: 500 });
  } finally {
    conn.release();
  }
}
