import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { collectorSession } from "@/lib/collector/guard";

export const dynamic = "force-dynamic";

const DecisionSchema = z
  .object({
    incidentIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(1).max(50),
    decision: z.enum(["verify", "escalate", "reject", "resolve", "reopen", "note"]),
    escalateTo: z.string().max(64).optional().nullable(),
    note: z.string().trim().max(2000).optional().nullable()
  })
  .refine((d) => !["reject", "note"].includes(d.decision) || !!d.note, {
    message: "Add a note explaining this.",
    path: ["note"]
  });

/** Next level in a department's escalation route, e.g. "AE → EE → SE" -> "EE". */
function nextLevel(route: string | null): string | null {
  const steps = String(route ?? "").split("→").map((s) => s.trim()).filter((s) => s && s !== "-");
  return steps[1] ?? steps[0] ?? null;
}

/**
 * Records Collector decisions in district_intel_ops (one or many incidents, for
 * bulk verify). The console shows them at once; the pipeline applies them on its
 * next build. Every decision is written to the audit log with the incident's
 * state at that moment.
 */
export async function POST(req: NextRequest) {
  const session = await collectorSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json().catch(() => null);
  // Accept a single incidentId too.
  if (body && typeof body.incidentId === "string" && !body.incidentIds) body.incidentIds = [body.incidentId];
  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const msg = issue?.path[0] === "incidentIds" ? "Invalid incident id." : issue?.message ?? "Invalid request.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const d = parsed.data;

  const conn = await intelPool.getConnection();
  try {
    const [incs] = await conn.query<RowDataPacket[]>(
      `SELECT i.incident_id, i.status_std, i.verified, i.is_open, i.severity_level, i.lead_dept, dp.route
       FROM incidents i LEFT JOIN ref_departments dp ON dp.code = i.lead_dept WHERE i.incident_id IN (?)`,
      [d.incidentIds]
    );
    if (incs.length !== new Set(d.incidentIds).size) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }
    if (d.escalateTo) {
      const [dept] = await conn.query<RowDataPacket[]>("SELECT code FROM ref_departments WHERE code = ?", [d.escalateTo]);
      if (dept.length === 0) return NextResponse.json({ error: "Unknown department." }, { status: 400 });
    }

    await conn.beginTransaction();
    const saved: { incident_id: string; decision_id: number; escalated_to_level: string | null }[] = [];
    for (const inc of incs) {
      const level = d.decision === "escalate" && !d.escalateTo ? nextLevel(inc.route) : null;
      const note = d.note || (level ? `Escalated to ${level}` : null);
      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO ${ops("collector_decisions")} (incident_id, decision, escalate_to, note, decided_by, decided_role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [inc.incident_id, d.decision, d.decision === "escalate" ? d.escalateTo || inc.lead_dept : null, note,
          session.email, session.role]
      );
      await conn.query(
        `INSERT INTO ${ops("audit_log")} (actor, action, table_name, record_id, before_value, after_value)
         VALUES (?, ?, 'collector_decisions', ?, ?, ?)`,
        [session.email, `decision:${d.decision}`, inc.incident_id,
          JSON.stringify({ status_std: inc.status_std, verified: inc.verified, is_open: inc.is_open, severity_level: inc.severity_level }),
          JSON.stringify({ decision_id: res.insertId, decision: d.decision, note, escalate_to: d.escalateTo ?? null })]
      );
      saved.push({ incident_id: inc.incident_id, decision_id: res.insertId, escalated_to_level: level });
    }
    await conn.commit();
    return NextResponse.json({ saved }, { status: 201 });
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    console.error("collector decision failed", err);
    return NextResponse.json({ error: "Could not save the decision." }, { status: 500 });
  } finally {
    conn.release();
  }
}
