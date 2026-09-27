import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { getActiveSession } from "@/lib/auth";
import intelPool, { ops } from "@/lib/collector/db";

export const dynamic = "force-dynamic";

const DecisionSchema = z
  .object({
    incidentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    decision: z.enum(["verify", "escalate", "reject", "resolve", "reopen", "note"]),
    escalateTo: z.string().max(64).optional().nullable(),
    note: z.string().trim().max(2000).optional().nullable()
  })
  .refine((d) => d.decision !== "escalate" || !!d.escalateTo, {
    message: "Choose the department to escalate to.",
    path: ["escalateTo"]
  })
  .refine((d) => !["reject", "note"].includes(d.decision) || !!d.note, {
    message: "Add a note explaining this.",
    path: ["note"]
  });

/**
 * Records a Collector decision in district_intel_ops. The dashboard shows it at
 * once; the pipeline applies it to the store on its next build. Every decision
 * is also written to the audit log with the incident's state at that moment.
 */
export async function POST(req: NextRequest) {
  const session = await getActiveSession();
  if (!session || session.role !== "collector") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = DecisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const d = parsed.data;

  const conn = await intelPool.getConnection();
  try {
    const [inc] = await conn.query<RowDataPacket[]>(
      "SELECT incident_id, status_std, verified, is_open, severity_level, lead_dept FROM incidents WHERE incident_id = ?",
      [d.incidentId]
    );
    if (inc.length === 0) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }
    if (d.escalateTo) {
      const [dept] = await conn.query<RowDataPacket[]>("SELECT code FROM ref_departments WHERE code = ?", [d.escalateTo]);
      if (dept.length === 0) {
        return NextResponse.json({ error: "Unknown department." }, { status: 400 });
      }
    }

    await conn.beginTransaction();
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO ${ops("collector_decisions")} (incident_id, decision, escalate_to, note, decided_by, decided_role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [d.incidentId, d.decision, d.decision === "escalate" ? d.escalateTo : null, d.note || null, session.email, session.role]
    );
    await conn.query(
      `INSERT INTO ${ops("audit_log")} (actor, action, table_name, record_id, before_value, after_value)
       VALUES (?, ?, 'collector_decisions', ?, ?, ?)`,
      [
        session.email,
        `decision:${d.decision}`,
        d.incidentId,
        JSON.stringify(inc[0]),
        JSON.stringify({ decision_id: res.insertId, ...d })
      ]
    );
    await conn.commit();

    const [saved] = await conn.query<RowDataPacket[]>(
      `SELECT decision_id, incident_id, decision, escalate_to, note, decided_by, decided_at
       FROM ${ops("collector_decisions")} WHERE decision_id = ?`,
      [res.insertId]
    );
    return NextResponse.json({ decision: saved[0] }, { status: 201 });
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    console.error("collector decision failed", err);
    return NextResponse.json({ error: "Could not save the decision." }, { status: 500 });
  } finally {
    conn.release();
  }
}
