import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

/**
 * The GCC complaint-type structure that drives the selection UI:
 * a "Frequently Filed Complaint Types" list plus one dropdown per category,
 * each holding that category's own subcomplaints.
 *
 * A frequent entry carries the same `id` as its entry inside the category
 * dropdown, so picking it selects the identical canonical subcomplaint.
 */
export async function GET() {
  const [catRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, sort_order FROM complaint_categories
      WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`
  );

  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.category_id, s.gcc_id, s.label, s.department_id,
            s.mapping_status, s.is_frequent, s.frequent_order, s.sort_order,
            d.name AS department_name
       FROM complaint_subtypes s
       LEFT JOIN departments d ON d.id = s.department_id
      WHERE s.is_active = 1
      ORDER BY s.sort_order ASC, s.label ASC`
  );

  const byCategory = new Map<number, RowDataPacket[]>();
  for (const s of subRows) {
    const list = byCategory.get(s.category_id as number) || [];
    list.push(s);
    byCategory.set(s.category_id as number, list);
  }

  const shape = (s: RowDataPacket) => ({
    id: s.id as number,
    gccId: s.gcc_id as number,
    label: s.label as string,
    categoryId: s.category_id as number,
    departmentId: (s.department_id as number | null) ?? null,
    departmentName: (s.department_name as string | null) ?? null,
    // 'unmapped' means GCC's own routing for this type was not published, so
    // the complaint is flagged for an officer to re-route rather than being
    // sent to a department this app guessed.
    mappingStatus: s.mapping_status as "mapped" | "unmapped"
  });

  const categories = catRows.map((c) => ({
    id: c.id as number,
    name: c.name as string,
    sortOrder: c.sort_order as number,
    subcomplaints: (byCategory.get(c.id as number) || []).map(shape)
  }));

  const frequent = subRows
    .filter((s) => s.is_frequent === 1)
    .sort((a, b) => (a.frequent_order as number) - (b.frequent_order as number))
    .map(shape);

  const [[src]] = await pool.query<RowDataPacket[]>(
    `SELECT source_url, source_label, fetched_at, notes
       FROM reference_data_sources WHERE dataset = 'complaint_types'`
  );

  const unmappedCount = subRows.filter((s) => s.mapping_status === "unmapped").length;

  return NextResponse.json({
    categories,
    frequent,
    source: src
      ? {
          url: src.source_url as string,
          label: src.source_label as string,
          fetchedAt: src.fetched_at as string,
          notes: src.notes as string
        }
      : null,
    counts: {
      categories: categories.length,
      subcomplaints: subRows.length,
      withoutDepartmentMapping: unmappedCount
    }
  });
}
