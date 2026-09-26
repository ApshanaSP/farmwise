import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { RowDataPacket } from "mysql2";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const session = await getSessionFromCookies();
  if (!session || session.role !== "citizen") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Every join is a LEFT JOIN: a complaint uses either the GCC reference data
  // (new) or the original locality/street tables (filed before the change), so
  // an INNER JOIN on either set would hide half the records.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.*,
            d.name  AS department_name,
            COALESCE(cs.label, ct.name) AS complaint_type_name,
            cc.name AS complaint_category_name,
            cs.mapping_status AS complaint_type_mapping_status,
            z.zone_name,
            COALESCE(gl.name, l.name) AS locality_name,
            ga.name AS area_name,
            -- A manually entered street is stored as text with an optional
            -- type; a listed street comes from the GCC street table.
            COALESCE(
              gs.name,
              NULLIF(TRIM(CONCAT(COALESCE(c.manual_street_name, ''), ' ', COALESCE(c.street_type, ''))), ''),
              s.name
            ) AS street_name,
            (c.gcc_street_id IS NULL AND c.manual_street_name IS NOT NULL) AS street_is_manual
     FROM complaints c
     LEFT JOIN departments d ON d.id = c.department_id
     LEFT JOIN complaint_subtypes cs ON cs.id = c.complaint_subtype_id
     LEFT JOIN complaint_categories cc ON cc.id = cs.category_id
     LEFT JOIN complaint_types ct ON ct.id = c.complaint_type_id
     LEFT JOIN zones z ON z.id = c.zone_id
     LEFT JOIN gcc_localities gl ON gl.id = c.gcc_locality_id
     LEFT JOIN gcc_areas ga ON ga.id = c.gcc_area_id
     LEFT JOIN gcc_streets gs ON gs.id = c.gcc_street_id
     LEFT JOIN localities l ON l.id = c.locality_id
     LEFT JOIN streets s ON s.id = c.street_id
     WHERE c.complaint_code = ?`,
    [params.code]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Complaint not found." }, { status: 404 });
  }

  const complaint = rows[0];

  // Enforce ownership: a citizen may only view their own complaints.
  if (complaint.user_id !== session.userId) {
    return NextResponse.json({ error: "You do not have access to this complaint." }, { status: 403 });
  }

  const [historyRows] = await pool.query<RowDataPacket[]>(
    "SELECT status, stage, remarks, created_at FROM complaint_status_history WHERE complaint_id = ? ORDER BY created_at ASC",
    [complaint.id]
  );

  return NextResponse.json({ complaint, history: historyRows });
}
