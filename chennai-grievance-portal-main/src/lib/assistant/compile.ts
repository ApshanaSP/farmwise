/**
 * Query plans to SQL, for questions no tool answers. The planner (a model) never writes SQL:
 * it fills a QueryPlan, and this module turns each query into one parameterized SELECT using
 * only the catalog's tables and columns, a fixed set of operators and aggregate functions,
 * joins along declared keys (one hop), the table's as-of cap, the console scope and a
 * MAX_EXECUTION_TIME hint. Every value is a bound parameter. A pre-count decides how a big
 * request shrinks (top 10 plus "Others", daily to weekly or monthly), and the result goes
 * through a read-only connection: the SELECT-only account when configured, otherwise a
 * READ ONLY transaction.
 *
 * Problems come back as CompileError messages the planner can repair (at most twice).
 */
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { connectionSettings } from "@/lib/db";
import intelPool, { INTEL_DB } from "@/lib/collector/db";
import { qualified, type Catalog, type CatalogColumn, type CatalogTable } from "@/lib/assistant/catalog";
import { LIMITS } from "@/lib/assistant/limits";
import type { Scope } from "@/lib/assistant/answer";

// ------------------------------------------------------------------- plan --
// Schemas the planner must fill: every field present (null when unused), no length or
// pattern keywords, so providers can enforce them as strict JSON schemas.

const Val = z.union([z.string(), z.number(), z.boolean()]);
export const MeasureSchema = z.object({ fn: z.enum(["count", "count_distinct", "sum", "avg", "min", "max"]), field: z.string().nullable(), alias: z.string() });
export const DimensionSchema = z.object({ field: z.string(), alias: z.string(), grain: z.enum(["day", "week", "month"]).nullable() });
export const FilterSchema = z.object({
  field: z.string(),
  op: z.enum(["eq", "ne", "in", "not_in", "gt", "gte", "lt", "lte", "between", "contains", "is_null", "not_null"]),
  value: Val.nullable(),
  values: z.array(z.union([z.string(), z.number()])).nullable()
});
export const TimeRangeSchema = z.object({
  field: z.string().nullable(),
  mode: z.enum(["relative", "since", "between", "all"]),
  last: z.number().nullable(),
  unit: z.enum(["hour", "day", "week", "month"]).nullable(),
  from: z.string().nullable(),
  to: z.string().nullable()
});
export const QuerySchema = z.object({
  id: z.string(),
  purpose: z.string(),
  table: z.string(),
  measures: z.array(MeasureSchema),
  dimensions: z.array(DimensionSchema),
  filters: z.array(FilterSchema),
  timeRange: TimeRangeSchema.nullable(),
  compare: z.enum(["previous_period"]).nullable(),
  sort: z.array(z.object({ by: z.string(), dir: z.enum(["asc", "desc"]) })),
  limit: z.number().nullable(),
  derive: z.array(z.object({ type: z.enum(["pct_change", "share", "rank"]), of: z.string(), alias: z.string() }))
});
export const PlanSchema = z.object({
  queries: z.array(QuerySchema),
  answerGoal: z.string(),
  chartIntent: z.enum(["ranking", "trend", "comparison", "composition", "distribution", "geo", "kpi", "table"]),
  assumptions: z.array(z.string()),
  unsupported: z.string().nullable()
});
export type QueryPlan = z.infer<typeof PlanSchema>;
export type PlanQuery = z.infer<typeof QuerySchema>;

export class CompileError extends Error {}

// ---------------------------------------------------------------- compile --

const HOURS = { hour: 1, day: 24, week: 168, month: 720 } as const;
const NUMERIC = /^(tinyint|smallint|mediumint|int|bigint|decimal|double|float)/;
const isTimeType = (t: string) => /^(datetime|timestamp|date)\b/.test(t);
const q = (s: string) => `\`${s.replace(/`/g, "")}\``;
const ALIAS = /^[a-z][a-z0-9_]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

interface Ref { sql: string; col: CatalogColumn; table: CatalogTable; alias: string }

export interface Compiled {
  id: string;
  purpose: string;
  table: CatalogTable;
  sql: string;
  params: unknown[];
  /** counts the groups (or rows) the query would return, before the cap */
  countSql: string;
  countParams: unknown[];
  dims: { alias: string; field: string; time: boolean; grain: string | null; col: CatalogColumn }[];
  measures: { alias: string; fn: string; col: CatalogColumn | null }[];
  records: boolean;
  limit: number;
  notes: string[];
  testData: boolean | null;
  /** the same query over the previous window, when compare = previous_period */
  previous: { sql: string; params: unknown[] } | null;
  /** pieces for re-running with a different grain or a top-N restriction */
  parts: { from: string; where: string; whereParams: unknown[]; order: string };
}

/** Scope filters to add when the query neither filters nor groups by that column. */
const SCOPE_COLUMNS: [keyof Scope, string[]][] = [
  ["zone", ["zone_no"]], ["dept", ["lead_dept", "dept_code", "department"]], ["cat", ["category_code"]], ["taluk", ["taluk_code"]]
];

export function compileQuery(pq: PlanQuery, cat: Catalog, asOf: string, scope: Scope | null): Compiled {
  const base = cat.tables.get(pq.table);
  if (!base) throw new CompileError(`Table "${pq.table}" is not in the catalog. Use one of: ${[...cat.tables.keys()].join(", ")}.`);
  if (!ALIAS.test(pq.id.toLowerCase())) throw new CompileError(`Query id "${pq.id}" must be a short lower-case name.`);
  const notes: string[] = [];
  const joins: { table: CatalogTable; alias: string; on: string }[] = [];

  /** a field of the base table ("zone_no") or of a table joined along a declared key ("ref_departments.name") */
  const ref = (name: string, purpose: string): Ref => {
    const [t, c] = name.includes(".") ? name.split(".", 2) : [base.name, name];
    if (t === base.name) {
      const col = base.columns.get(c);
      if (!col) throw new CompileError(`Column "${c}" (${purpose}) is not available on ${base.name}. Available: ${[...base.columns.keys()].join(", ")}.`);
      return { sql: `b.${q(c)}`, col, table: base, alias: "b" };
    }
    const other = cat.tables.get(t);
    if (!other) throw new CompileError(`Table "${t}" (${purpose}) is not in the catalog.`);
    const col = other.columns.get(c);
    if (!col) throw new CompileError(`Column "${c}" (${purpose}) is not available on ${t}.`);
    let j = joins.find((x) => x.table.name === t);
    if (!j) {
      const fwd = [...base.columns.values()].find((bc) => bc.join?.startsWith(`${t}.`));
      const back = [...other.columns.values()].find((oc) => oc.join?.startsWith(`${base.name}.`));
      const alias = `j${joins.length + 1}`;
      if (fwd) j = { table: other, alias, on: `b.${q(fwd.name)} = ${alias}.${q(fwd.join!.split(".")[1])}` };
      else if (back) j = { table: other, alias, on: `${alias}.${q(back.name)} = b.${q(back.join!.split(".")[1])}` };
      else throw new CompileError(`${t} cannot be joined to ${base.name}: no declared key links them.`);
      joins.push(j);
    }
    return { sql: `${j.alias}.${q(c)}`, col, table: other, alias: j.alias };
  };

  if (pq.measures.length === 0 && pq.dimensions.length === 0) throw new CompileError("Select at least one measure or dimension.");
  if (pq.dimensions.filter((d) => !d.grain).length > LIMITS.dimensionsPerQuery || pq.dimensions.length > LIMITS.dimensionsPerQuery + 1) {
    throw new CompileError(`Group by at most ${LIMITS.dimensionsPerQuery} fields.`);
  }
  const used = new Set<string>();
  const aliasOk = (a: string, what: string) => {
    const x = a.toLowerCase();
    if (!ALIAS.test(x)) throw new CompileError(`Alias "${a}" (${what}) must be lower-case letters, digits and _.`);
    if (used.has(x)) throw new CompileError(`Alias "${a}" is used twice.`);
    used.add(x);
    return x;
  };

  // dimensions
  const dims = pq.dimensions.map((d) => {
    const r = ref(d.field, "dimension");
    if (["geo"].includes(r.col.role)) throw new CompileError(`Cannot group by ${d.field}.`);
    const time = isTimeType(r.col.type);
    if (d.grain && !time) throw new CompileError(`A grain (${d.grain}) only applies to a date or time column; ${d.field} is not one.`);
    return { alias: aliasOk(d.alias, "dimension"), field: d.field, time, grain: time ? d.grain ?? "day" : null, col: r.col, expr: r.sql };
  });
  const dimSql = (d: (typeof dims)[number], grain = d.grain) =>
    !d.time ? d.expr : grain === "month" ? `DATE_FORMAT(${d.expr}, '%Y-%m')`
      : grain === "week" ? `DATE_FORMAT(DATE_SUB(DATE(${d.expr}), INTERVAL WEEKDAY(${d.expr}) DAY), '%Y-%m-%d')` : `DATE_FORMAT(${d.expr}, '%Y-%m-%d')`;

  // measures
  const measures = pq.measures.map((m) => {
    const alias = aliasOk(m.alias, "measure");
    if (m.fn === "count" && !m.field) return { alias, fn: m.fn, col: null as CatalogColumn | null, sql: "COUNT(*)" };
    if (!m.field) throw new CompileError(`${m.fn} needs a field.`);
    const r = ref(m.field, "measure");
    if (m.fn === "count") return { alias, fn: m.fn, col: r.col, sql: `COUNT(${r.sql})` };
    if (m.fn === "count_distinct") return { alias, fn: m.fn, col: r.col, sql: `COUNT(DISTINCT ${r.sql})` };
    if (!NUMERIC.test(r.col.type) || !["measure", "flag"].includes(r.col.role)) throw new CompileError(`${m.fn} needs a numeric measure; ${m.field} is ${r.col.role}.`);
    return { alias, fn: m.fn, col: r.col, sql: `${m.fn.toUpperCase()}(${r.sql})` };
  });
  const records = measures.length === 0;

  // where: cap, time range, filters, scope
  const where: string[] = [];
  const params: unknown[] = [];
  const capped = (t: CatalogTable, alias: string) => {
    if (!t.cap) return;
    const parts = t.cap.split(":asOf");
    where.push(parts.map((p, i) => (i ? "?" : "") + p.replace(/`([a-z0-9_]+)`/g, `${alias}.\`$1\``)).join(""));
    for (let i = 1; i < parts.length; i++) params.push(asOf);
  };
  capped(base, "b");

  const tr = pq.timeRange;
  let windowHours: number | null = null;
  let timeRef: Ref | null = null;
  if (tr && tr.mode !== "all") {
    const f = tr.field ?? base.time;
    if (!f) throw new CompileError(`${base.name} has no time column for a time range.`);
    timeRef = ref(f, "time range");
    if (!isTimeType(timeRef.col.type)) throw new CompileError(`${f} is not a date or time column.`);
    if (tr.mode === "relative") {
      const n = Math.round(Number(tr.last));
      if (!tr.unit || !Number.isFinite(n) || n < 1 || n * HOURS[tr.unit] > 24 * 400) throw new CompileError("A relative time range needs last (1 or more) and a unit, within 400 days.");
      windowHours = n * HOURS[tr.unit];
      where.push(`${timeRef.sql} > (? - INTERVAL ? HOUR) AND ${timeRef.sql} <= ?`);
      params.push(asOf, windowHours, asOf);
    } else {
      if (!tr.from || !DATE.test(tr.from)) throw new CompileError("from must be a date (YYYY-MM-DD).");
      if (tr.mode === "between" && (!tr.to || !DATE.test(tr.to))) throw new CompileError("to must be a date (YYYY-MM-DD).");
      where.push(`${timeRef.sql} >= ? AND ${timeRef.sql} <= ?`);
      params.push(tr.from, tr.mode === "between" ? `${tr.to!.slice(0, 10)} 23:59:59` : asOf);
    }
  }

  for (const f of pq.filters) {
    const r = ref(f.field, "filter");
    const vals = f.values ?? [];
    const one = f.value;
    const known = r.col.values;
    const norm = (v: unknown) => {
      if (known && typeof v === "string") {
        const hit = known.find((k) => k.toLowerCase() === v.toLowerCase());
        if (!hit) throw new CompileError(`${f.field} takes ${known.join(", ")}; got "${v}".`);
        return hit;
      }
      return typeof v === "boolean" ? (v ? 1 : 0) : v;
    };
    switch (f.op) {
      case "eq": case "ne": case "gt": case "gte": case "lt": case "lte": {
        if (one == null) throw new CompileError(`${f.op} on ${f.field} needs a value.`);
        where.push(`${r.sql} ${{ eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op]} ?`);
        params.push(norm(one));
        break;
      }
      case "in": case "not_in": {
        if (!vals.length || vals.length > 50) throw new CompileError(`${f.op} on ${f.field} needs 1 to 50 values.`);
        where.push(`${r.sql} ${f.op === "in" ? "IN" : "NOT IN"} (?)`);
        params.push(vals.map(norm));
        break;
      }
      case "between": {
        if (vals.length !== 2) throw new CompileError(`between on ${f.field} needs two values.`);
        where.push(`${r.sql} BETWEEN ? AND ?`);
        params.push(norm(vals[0]), norm(vals[1]));
        break;
      }
      case "contains": {
        if (typeof one !== "string" || !one.trim()) throw new CompileError(`contains on ${f.field} needs text.`);
        where.push(`${r.sql} LIKE ?`);
        params.push(`%${one.trim().slice(0, 60).replace(/[%_\\]/g, (m) => "\\" + m)}%`);
        break;
      }
      case "is_null": where.push(`${r.sql} IS NULL`); break;
      case "not_null": where.push(`${r.sql} IS NOT NULL`); break;
    }
  }

  // the console's filters, where the query does not decide that column itself
  if (scope) {
    for (const [key, cols] of SCOPE_COLUMNS) {
      const v = scope[key];
      if (v == null) continue;
      const col = cols.find((c) => base.columns.has(c));
      if (!col) continue;
      const decided = pq.filters.some((f) => f.field === col || f.field.endsWith(`.${col}`)) || pq.dimensions.some((d) => d.field === col);
      if (decided) continue;
      where.push(`b.${q(col)} = ?`);
      params.push(v);
      notes.push(`Console filter applied: ${key} = ${v}.`);
    }
  }

  const from = `${qualified(base)} b ${joins.map((j) => `LEFT JOIN ${qualified(j.table)} ${j.alias} ON ${j.on}`).join(" ")}`.trim();
  const W = where.length ? where.join(" AND ") : "1=1";
  const testExpr = base.test === "0" || base.test === "1" ? null : base.test.replace(/\b([a-z_]+)\b(?=\s*(=|IN|<>|>|<))/g, "b.`$1`");
  const colTest = [...measures.map((m) => m.col), ...dims.map((d) => d.col)].some((c) => c?.test);
  const testData = base.test === "1" || colTest ? true : base.test === "0" ? false : null;

  // sort and limit
  const aliases = new Set([...dims.map((d) => d.alias), ...measures.map((m) => m.alias)]);
  const sorts = pq.sort.filter((s) => aliases.has(s.by.toLowerCase())).map((s) => `${q(s.by.toLowerCase())} ${s.dir === "asc" ? "ASC" : "DESC"}`);
  const timeDim = dims.find((d) => d.time);
  const order = sorts.length ? sorts.join(", ") : timeDim ? `${q(timeDim.alias)} ASC` : measures.length ? `${q(measures[0].alias)} DESC` : "1";
  const cap = records ? LIMITS.rowsMore : LIMITS.groupsComputed;
  const limit = Math.max(1, Math.min(cap, Math.round(Number(pq.limit) || (records ? LIMITS.rowsShown : LIMITS.groupsComputed))));

  const hint = `/*+ MAX_EXECUTION_TIME(${LIMITS.queryMs}) */`;
  const select = records
    ? [...dims.map((d) => `${dimSql(d)} AS ${q(d.alias)}`), ...(testExpr ? [`(${testExpr}) AS \`__test\``] : [])]
    : [...dims.map((d) => `${dimSql(d)} AS ${q(d.alias)}`), ...measures.map((m) => `${m.sql} AS ${q(m.alias)}`), ...(testExpr ? [`MAX(${testExpr}) AS \`__test\``] : [])];
  const group = !records && dims.length ? ` GROUP BY ${dims.map((d) => q(d.alias)).join(", ")}` : "";
  const sql = `SELECT ${hint} ${select.join(", ")} FROM ${from} WHERE ${W}${group} ORDER BY ${order} LIMIT ?`;
  const countSql = records
    ? `SELECT ${hint} COUNT(*) AS n FROM ${from} WHERE ${W}`
    : dims.length ? `SELECT ${hint} COUNT(*) AS n FROM (SELECT 1 FROM ${from} WHERE ${W}${group.replace(/`([a-z0-9_]+)`/g, (m, a) => dimSql(dims.find((d) => d.alias === a)!))}) x`
      : `SELECT ${hint} 1 AS n`;

  let previous: Compiled["previous"] = null;
  if (pq.compare === "previous_period") {
    if (!windowHours || !timeRef) throw new CompileError("compare = previous_period needs a relative time range.");
    const pParams = params.map((p, i) => p);
    // shift the relative window back by its own length: (asOf - 2h, asOf - h]
    const k = where.findIndex((w) => w.startsWith(`${timeRef!.sql} > (? - INTERVAL ? HOUR)`));
    const shifted = [...where];
    shifted[k] = `${timeRef.sql} > (? - INTERVAL ? HOUR) AND ${timeRef.sql} <= (? - INTERVAL ? HOUR)`;
    const pos = where.slice(0, k).reduce((a, w) => a + (w.match(/\?/g)?.length ?? 0), 0);
    const pp = [...pParams.slice(0, pos), asOf, windowHours * 2, asOf, windowHours, ...pParams.slice(pos + 3)];
    previous = { sql: `SELECT ${hint} ${select.join(", ")} FROM ${from} WHERE ${shifted.join(" AND ")}${group} ORDER BY ${order} LIMIT ?`, params: [...pp, LIMITS.groupsComputed] };
  }

  return {
    id: pq.id.toLowerCase(), purpose: pq.purpose, table: base, sql, params: [...params, limit], countSql, countParams: params,
    dims: dims.map(({ alias, field, time, grain, col }) => ({ alias, field, time, grain, col })), measures: measures.map(({ alias, fn, col }) => ({ alias, fn, col })),
    records, limit, notes, testData, previous, parts: { from, where: W, whereParams: params, order }
  };
}

// ---------------------------------------------------------------- execute --

declare global {
  // eslint-disable-next-line no-var
  var __assistantRoPool: Pool | undefined;
}

/** The SELECT-only account's pool (ASSISTANT_RO_DB_USER), or null when it is not configured. */
function roPool(): Pool | null {
  const user = process.env.ASSISTANT_RO_DB_USER, password = process.env.ASSISTANT_RO_DB_PASSWORD;
  if (!user || !password) return null;
  global.__assistantRoPool ??= mysql.createPool({ ...connectionSettings(), user, password, database: INTEL_DB, connectionLimit: 4, waitForConnections: true,
    queueLimit: 20, dateStrings: true, decimalNumbers: true });
  return global.__assistantRoPool;
}

export function readOnlyMode(): "select-only account" | "read-only transaction" {
  return roPool() ? "select-only account" : "read-only transaction";
}

/** Run SELECTs on a read-only connection: the SELECT-only account, else a READ ONLY transaction on the console's pool. */
export async function readOnly<T>(run: (query: (sql: string, params: unknown[]) => Promise<RowDataPacket[]>) => Promise<T>): Promise<T> {
  const pool = roPool() ?? intelPool;
  const conn = await pool.getConnection();
  try {
    await conn.query("START TRANSACTION READ ONLY");
    const out = await run(async (sql, params) => {
      if (!/^\s*SELECT\b/i.test(sql)) throw new CompileError("Only SELECT statements run here.");
      const [rows] = await conn.query<RowDataPacket[]>(sql, params);
      return rows;
    });
    await conn.query("COMMIT");
    return out;
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}

export interface QueryResult {
  id: string;
  purpose: string;
  rows: Record<string, unknown>[];
  /** groups (or rows) before any shrinking */
  total: number;
  sql: { text: string; params: unknown[] }[];
  notes: string[];
  testData: boolean;
  compiled: Compiled;
}

const DAY = 864e5;

/**
 * Run one compiled query with the size rules: a daily series longer than 120 points (30 when
 * it is split into series) is re-grained to weeks, then months; more than 10 categories keep
 * the top 10 plus "Others"; records are capped at 20 (100 on request).
 */
export async function runCompiled(c: Compiled, asOf: string): Promise<QueryResult> {
  return readOnly(async (run) => {
    const sqls: QueryResult["sql"] = [];
    const exec = async (text: string, params: unknown[]) => { sqls.push({ text, params }); return run(text, params); };
    const notes = [...c.notes];
    let compiled = c;
    const [cnt] = await exec(c.countSql, c.countParams);
    const total = Number(cnt?.n ?? 0);

    const timeDim = c.dims.find((d) => d.time);
    const catDim = c.dims.find((d) => !d.time);
    // re-grain a long time series
    if (!c.records && timeDim && timeDim.grain === "day") {
      const [span] = await exec(`SELECT /*+ MAX_EXECUTION_TIME(${LIMITS.queryMs}) */ COUNT(DISTINCT DATE(b.${q(timeDim.col.name)})) AS n FROM ${c.parts.from} WHERE ${c.parts.where}`, c.parts.whereParams);
      const days = Number(span?.n ?? 0);
      const maxPoints = catDim ? 31 : LIMITS.pointsPerSeries;
      if (days > maxPoints) {
        const grain = days / 7 <= maxPoints ? "week" : "month";
        notes.push(`${days} days of data re-grouped by ${grain} to stay readable.`);
        compiled = regrain(c, grain);
      }
    }
    let rows: Record<string, unknown>[];
    if (!c.records && catDim && timeDim) {
      // two dimensions: the top 10 categories by total, the rest as "Others"
      const [top] = [await exec(
        `SELECT /*+ MAX_EXECUTION_TIME(${LIMITS.queryMs}) */ b.${q(catDim.col.name)} AS k FROM ${c.parts.from} WHERE ${c.parts.where} GROUP BY k ORDER BY COUNT(*) DESC LIMIT ?`,
        [...c.parts.whereParams, LIMITS.groupsShown + 1])];
      const keys = top.map((r) => r.k);
      rows = await exec(compiled.sql.replace(/ LIMIT \?$/, ""), compiled.params.slice(0, -1));
      const cats = new Set(rows.map((r) => r[catDim.alias]));
      if (cats.size > LIMITS.groupsShown) {
        const keep = new Set(keys.slice(0, LIMITS.groupsShown));
        const others = new Map<string, Record<string, unknown>>();
        const kept: Record<string, unknown>[] = [];
        for (const r of rows) {
          if (keep.has(r[catDim.alias])) { kept.push(r); continue; }
          const t = String(r[timeDim.alias]);
          const o = others.get(t) ?? { [timeDim.alias]: t, [catDim.alias]: "Others" };
          for (const m of c.measures) if (["count", "sum"].includes(m.fn)) o[m.alias] = Number(o[m.alias] ?? 0) + Number(r[m.alias] ?? 0);
          others.set(t, o);
        }
        notes.push(`${cats.size} ${catDim.field} values: the top ${LIMITS.groupsShown} are shown and the rest summed as "Others".`);
        rows = [...kept, ...others.values()].sort((a, b) => String(a[timeDim.alias]).localeCompare(String(b[timeDim.alias])));
      }
    } else {
      rows = await exec(compiled.sql, compiled.params);
      if (!c.records && catDim && total > rows.length) notes.push(`${total} groups in all; the largest ${rows.length} are shown.`);
      if (c.records && total > rows.length) notes.push(`${total} records match; ${rows.length} are shown.`);
    }
    // previous period, merged by the dimension values
    if (c.previous) {
      const prev = await exec(c.previous.sql, c.previous.params);
      const key = (r: Record<string, unknown>) => c.dims.filter((d) => !d.time).map((d) => String(r[d.alias])).join("|");
      const byKey = new Map(prev.map((r) => [key(r), r]));
      rows = rows.map((r) => ({ ...r, ...Object.fromEntries(c.measures.map((m) => [`${m.alias}_prev`, byKey.get(key(r))?.[m.alias] ?? 0])) }));
    }
    const testData = c.testData ?? rows.some((r) => Number(r.__test) === 1);
    rows = rows.map(({ __test, ...r }) => r);
    void asOf; void DAY;
    return { id: c.id, purpose: c.purpose, rows, total, sql: sqls, notes, testData, compiled };
  });
}

/** The same query at a coarser time grain. */
function regrain(c: Compiled, grain: "week" | "month"): Compiled {
  const t = c.dims.find((d) => d.time)!;
  const e = `b.${q(t.col.name)}`;
  const day = `DATE_FORMAT(${e}, '%Y-%m-%d')`;
  const to = grain === "month" ? `DATE_FORMAT(${e}, '%Y-%m')` : `DATE_FORMAT(DATE_SUB(DATE(${e}), INTERVAL WEEKDAY(${e}) DAY), '%Y-%m-%d')`;
  return { ...c, sql: c.sql.split(day).join(to), dims: c.dims.map((d) => (d.time ? { ...d, grain } : d)) };
}
