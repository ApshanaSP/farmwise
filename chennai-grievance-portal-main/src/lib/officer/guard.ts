import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { getActiveSession } from "@/lib/auth";
import type { JwtPayload } from "@/types";
import { parsePeriod, parseTaluk, parseZone, type Period } from "@/lib/collector/intel";
import { OFFICER, codeForPortalDept } from "./departments";
import { deptProfile, type DeptProfile, type Scope } from "./data";

export interface OfficerContext {
  session: JwtPayload;
  dept: DeptProfile;
}

/**
 * The officer's department code, read from the database on every request rather than
 * trusted from the token, so reassigning an officer takes effect at once.
 * users.dept_code (migration 011) wins; otherwise the portal department maps to a code.
 */
export async function officerDeptCode(userId: number): Promise<string | null> {
  let rows: RowDataPacket[];
  try {
    [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.dept_code, d.name AS portal_dept FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ? LIMIT 1`,
      [userId]
    );
  } catch (err: any) {
    if (err?.code !== "ER_BAD_FIELD_ERROR") throw err;
    // migration 011 not applied yet: GCC departments only
    [rows] = await pool.query<RowDataPacket[]>(
      `SELECT NULL AS dept_code, d.name AS portal_dept FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ? LIMIT 1`,
      [userId]
    );
  }
  const r = rows[0];
  if (!r) return null;
  return (r.dept_code as string | null) || codeForPortalDept(r.portal_dept as string | null);
}

/**
 * The signed-in, active department officer and their department, or the response to return.
 * Only department officers use this console (the Collector signs in to the Collector console);
 * the department always comes from the database, never from the request.
 * The arguments are kept for the routes' existing calls and are not used.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function officerSession(_params?: URLSearchParams, _opts: { write?: boolean } = {}): Promise<OfficerContext | NextResponse> {
  const session = await getActiveSession();
  if (!session || session.role !== "department_officer") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const code = await officerDeptCode(session.userId);
  const dept = code ? await deptProfile(code) : null;
  if (!dept) {
    return NextResponse.json({ error: "Your account is not linked to a department. Ask the administrator to set it." }, { status: 403 });
  }
  return { session, dept };
}

export function failed(err: unknown, what: string) {
  console.error(`officer ${what} failed`, err);
  return NextResponse.json({ error: `Could not load ${what}.` }, { status: 500 });
}

/** JSON the browser must never cache: every request reads the store afresh. */
export function fresh(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

/** Period, zone and taluk from the query string; the console opens on OFFICER.defaultPeriod. */
export function parseScope(p: URLSearchParams): Scope {
  return {
    period: p.get("period") ? parsePeriod(p.get("period")) : (OFFICER.defaultPeriod as Period),
    zone: parseZone(p.get("zone")),
    taluk: parseTaluk(p.get("taluk"))
  };
}

/** Incident ids as the pipeline writes them (INC-1234, ...). */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
