/**
 * Saved Collector workspaces: the dashboard's filters and layout plus a frozen copy of
 * the briefing, versioned by name, so "last week's version" can be reopened as it was.
 */
import { RowDataPacket, ResultSetHeader } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { audit } from "@/lib/collector/sources";

type Row = Record<string, any>;
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v ?? null);

export async function listWorkspaces(owner: string) {
  const [rows] = await intelPool.query<RowDataPacket[]>(
    `SELECT w.workspace_id AS id, w.name, w.version, w.is_current, w.layout, w.filters, DATE_FORMAT(w.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM ${ops("workspaces")} w WHERE w.owner = ? ORDER BY w.name, w.version DESC`,
    [owner]
  );
  const by = new Map<string, Row[]>();
  for (const r of rows) (by.get(r.name) ?? by.set(r.name, []).get(r.name)!).push({ ...r, filters: parse(r.filters), layout: parse(r.layout) });
  return [...by.entries()].map(([name, versions]) => ({ name, versions }));
}

export async function saveWorkspace(owner: string, w: { name: string; filters: Row; layout: Row; briefing?: { md: string; facts: Row; period: string; asOf: string } }) {
  const conn = await intelPool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query<RowDataPacket[]>(`SELECT COALESCE(MAX(version), 0) AS v FROM ${ops("workspaces")} WHERE owner = ? AND name = ?`, [owner, w.name]);
    const version = Number(v.v) + 1;
    let archiveId: number | null = null;
    if (w.briefing) {
      const [a] = await conn.query<ResultSetHeader>(
        `INSERT INTO ${ops("briefing_archive")} (briefing_id, period, as_of, markdown, fact_pack, method, issued_by)
         VALUES (?, ?, ?, ?, ?, 'workspace snapshot', ?)`,
        [`WS-${w.name}`.slice(0, 64), w.briefing.period, w.briefing.asOf, w.briefing.md, JSON.stringify(w.briefing.facts), `${owner} v${version}`]
      );
      archiveId = a.insertId;
    }
    await conn.query(`UPDATE ${ops("workspaces")} SET is_current = 0 WHERE owner = ? AND name = ?`, [owner, w.name]);
    const [r] = await conn.query<ResultSetHeader>(
      `INSERT INTO ${ops("workspaces")} (owner, name, version, is_current, layout, filters) VALUES (?, ?, ?, 1, ?, ?)`,
      [owner, w.name, version, JSON.stringify(w.layout), JSON.stringify({ ...w.filters, archiveId })]
    );
    await conn.commit();
    await audit(owner, "workspace:save", "workspaces", r.insertId, null, { name: w.name, version, filters: w.filters });
    return { id: r.insertId, version };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function openWorkspace(owner: string, id: number) {
  const [[w]] = await intelPool.query<RowDataPacket[]>(
    `SELECT workspace_id AS id, name, version, is_current, layout, filters, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM ${ops("workspaces")} WHERE workspace_id = ? AND owner = ?`,
    [id, owner]
  );
  if (!w) return null;
  const filters = parse(w.filters) as Row;
  let briefing: Row | null = null;
  if (filters?.archiveId) {
    const [[a]] = await intelPool.query<RowDataPacket[]>(
      `SELECT markdown, fact_pack, period, DATE_FORMAT(as_of, '%Y-%m-%d %H:%i:%s') AS as_of, DATE_FORMAT(issued_at, '%Y-%m-%d %H:%i:%s') AS issued_at
       FROM ${ops("briefing_archive")} WHERE archive_id = ?`,
      [filters.archiveId]
    );
    if (a) briefing = { ...a, facts: a.fact_pack ? JSON.parse(a.fact_pack) : null };
  }
  await audit(owner, "workspace:open", "workspaces", id, null, { name: w.name, version: w.version });
  return { ...w, filters, layout: parse(w.layout), briefing };
}

export async function auditLog(limit = 200) {
  const [rows] = await intelPool.query<RowDataPacket[]>(
    `SELECT log_id AS id, DATE_FORMAT(at, '%Y-%m-%d %H:%i:%s') AS at, actor, action, table_name, record_id, LEFT(after_value, 400) AS after_value
     FROM ${ops("audit_log")} ORDER BY log_id DESC LIMIT ?`,
    [limit]
  );
  return rows;
}
