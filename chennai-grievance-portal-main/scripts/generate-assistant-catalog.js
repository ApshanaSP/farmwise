/**
 * Snapshot of the schema behind the assistant's data catalog: every table, view and column
 * of the intelligence store (district_intel) and the dashboard's own database
 * (district_intel_ops), read from information_schema, written to
 * src/lib/assistant/schema.snapshot.json.
 *
 * src/lib/assistant/catalog.ts lays the curated descriptions, allowlist and private columns
 * over the schema. At run time it reads information_schema itself; this file is its
 * fallback when the database cannot be reached, the fixture for tests, and a reviewable
 * record of what the pipeline exported. Re-run after a pipeline change adds or renames
 * columns, then describe any new column in catalog.ts (new columns stay unavailable until
 * they are described).
 *
 *   node scripts/generate-assistant-catalog.js
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { getDbConfig } = require("./db-config");

const INTEL = process.env.INTEL_DB_NAME || "district_intel";
const OPS = process.env.INTEL_OPS_DB_NAME || "district_intel_ops";
const OUT = path.join(__dirname, "..", "src", "lib", "assistant", "schema.snapshot.json");

async function main() {
  const cfg = getDbConfig();
  delete cfg.database;
  const db = await mysql.createConnection(cfg);
  const [[ver]] = await db.query("SELECT VERSION() AS v");
  const [rows] = await db.query(
    `SELECT c.table_schema AS db, c.table_name AS t, c.column_name AS c, c.column_type AS type, tb.table_type AS kind
     FROM information_schema.columns c
     JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema IN (?, ?) ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    [INTEL, OPS]
  );
  await db.end();

  const tables = {};
  for (const r of rows) {
    const key = `${r.db === INTEL ? "intel" : "ops"}.${r.t}`;
    tables[key] ??= { kind: r.kind === "VIEW" ? "view" : "table", columns: {} };
    tables[key].columns[r.c] = String(r.type);
  }
  const sorted = Object.fromEntries(Object.keys(tables).sort().map((k) => [k, tables[k]]));
  const snapshot = {
    generated_at: new Date().toISOString(),
    source: `information_schema, MySQL ${ver.v}`,
    databases: { intel: INTEL, ops: OPS },
    tables: sorted
  };
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + "\n");

  const count = (p, k) => Object.entries(sorted).filter(([n, t]) => n.startsWith(p) && t.kind === k).length;
  const cols = Object.values(sorted).reduce((a, t) => a + Object.keys(t.columns).length, 0);
  console.log(`${INTEL}: ${count("intel.", "table")} tables, ${count("intel.", "view")} views; ${OPS}: ${count("ops.", "table")} tables; ${cols} columns`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
