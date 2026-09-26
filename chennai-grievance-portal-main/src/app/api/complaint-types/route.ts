import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

export async function GET() {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ct.id, ct.name, ct.department_id, ct.is_frequent, d.name AS department_name
     FROM complaint_types ct
     JOIN departments d ON d.id = ct.department_id
     ORDER BY d.name ASC, ct.name ASC`
  );
  return NextResponse.json({ complaintTypes: rows });
}
