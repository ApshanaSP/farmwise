import { describe, expect, it } from "vitest";
import snapshot from "@/lib/assistant/schema.snapshot.json";
import { PRIVATE_COLUMNS, buildCatalog, joinable, type SchemaSnapshot } from "@/lib/assistant/catalog";
import { CompileError, compileQuery, type PlanQuery } from "@/lib/assistant/compile";

const cat = buildCatalog(snapshot as unknown as SchemaSnapshot);
const AS_OF = "2026-09-29 18:43:00";
const q = (p: Partial<PlanQuery>): PlanQuery => ({
  id: "q1", purpose: "test", table: "incidents", measures: [{ fn: "count", field: null, alias: "n" }], dimensions: [], filters: [], timeRange: null,
  compare: null, sort: [], limit: null, derive: [], ...p
});

describe("catalog", () => {
  it("matches the schema snapshot with no drift", () => {
    expect(cat.drift).toEqual({ missingTables: [], missingColumns: [], undescribedTables: [], undescribedColumns: [] });
  });
  it("never offers forecasts, the pipeline KPI snapshot or projection columns", () => {
    expect(cat.tables.has("forecasts")).toBe(false);
    expect(cat.tables.has("kpis")).toBe(false);
    expect(cat.tables.get("observation_signals")!.columns.has("days_to_full")).toBe(false);
    expect(cat.tables.get("observation_signals")!.columns.has("slope_per_day")).toBe(false);
  });
  it("never offers a private column", () => {
    for (const [table, cols] of Object.entries(PRIVATE_COLUMNS)) for (const c of cols) expect(cat.tables.get(table)?.columns.has(c) ?? false).toBe(false);
    expect(cat.tables.get("events")!.columns.has("reporter_hash")).toBe(false);
    expect(cat.tables.get("official_contacts")!.columns.has("phone")).toBe(false);
    expect(cat.tables.get("official_contacts")!.columns.has("email")).toBe(false);
  });
  it("declares joins", () => {
    expect(joinable(cat, { table: "incidents", column: "lead_dept" }, { table: "ref_departments", column: "code" })).toBe(true);
    expect(joinable(cat, { table: "incidents", column: "title" }, { table: "ref_departments", column: "code" })).toBe(false);
  });
});

describe("compiler", () => {
  it("compiles a ranking with the as-of cap, a time window, a join and a time limit hint", () => {
    const c = compileQuery(q({
      measures: [{ fn: "count", field: null, alias: "severe" }], dimensions: [{ field: "ref_departments.name", alias: "department", grain: null }],
      filters: [{ field: "severity_level", op: "eq", value: "severe", values: null }], timeRange: { field: null, mode: "relative", last: 7, unit: "day", from: null, to: null },
      sort: [{ by: "severe", dir: "desc" }], limit: 10
    }), cat, AS_OF, null);
    expect(c.sql).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\//);
    expect(c.sql).toContain("LEFT JOIN `district_intel`.`ref_departments` j1 ON b.`lead_dept` = j1.`code`");
    expect(c.sql).toContain("b.`first_reported_at` <= ?");
    expect(c.params).toContain("Severe"); // value normalised to the catalog's list
    expect(c.params[c.params.length - 1]).toBe(10);
  });
  it("keeps every value a bound parameter, even an injection attempt", () => {
    const evil = "x' OR 1=1; DROP TABLE incidents; --";
    const c = compileQuery(q({ filters: [{ field: "place_text", op: "contains", value: evil, values: null }] }), cat, AS_OF, null);
    expect(c.sql).not.toContain("DROP");
    expect(c.sql).not.toContain("OR 1=1");
    expect(c.params.some((p) => String(p).includes("DROP TABLE"))).toBe(true);
  });
  it("rejects tables, columns and joins outside the catalog", () => {
    expect(() => compileQuery(q({ table: "forecasts" }), cat, AS_OF, null)).toThrow(CompileError);
    expect(() => compileQuery(q({ table: "users" }), cat, AS_OF, null)).toThrow(CompileError);
    expect(() => compileQuery(q({ table: "events", dimensions: [{ field: "reporter_hash", alias: "r", grain: null }] }), cat, AS_OF, null)).toThrow(/not available/);
    expect(() => compileQuery(q({ dimensions: [{ field: "official_contacts.email", alias: "e", grain: null }] }), cat, AS_OF, null)).toThrow(CompileError);
    expect(() => compileQuery(q({ dimensions: [{ field: "zone_no; DROP TABLE x", alias: "z", grain: null }] }), cat, AS_OF, null)).toThrow(CompileError);
  });
  it("rejects bad aliases and values outside a column's list", () => {
    expect(() => compileQuery(q({ measures: [{ fn: "count", field: null, alias: "n`; DROP" }] }), cat, AS_OF, null)).toThrow(/Alias/);
    expect(() => compileQuery(q({ filters: [{ field: "severity_level", op: "eq", value: "Catastrophic", values: null }] }), cat, AS_OF, null)).toThrow(/takes/);
  });
  it("needs numeric fields for sums and averages", () => {
    expect(() => compileQuery(q({ measures: [{ fn: "sum", field: "zone_name", alias: "s" }] }), cat, AS_OF, null)).toThrow(/numeric/);
  });
  it("applies the console's scope unless the query decides that column", () => {
    const scope = { period: "weekly" as const, zone: 9, dept: null, cat: null, taluk: null };
    expect(compileQuery(q({}), cat, AS_OF, scope).params).toContain(9);
    expect(compileQuery(q({ dimensions: [{ field: "zone_no", alias: "zone", grain: null }] }), cat, AS_OF, scope).params).not.toContain(9);
  });
  it("caps rows and groups", () => {
    expect(compileQuery(q({ limit: 5000, dimensions: [{ field: "ward_no", alias: "ward", grain: null }] }), cat, AS_OF, null).limit).toBe(50);
    expect(compileQuery(q({ measures: [], dimensions: [{ field: "incident_id", alias: "id", grain: null }], limit: 999 }), cat, AS_OF, null).limit).toBe(100);
  });
  it("shifts the window for a previous-period comparison", () => {
    const c = compileQuery(q({ timeRange: { field: null, mode: "relative", last: 7, unit: "day", from: null, to: null }, compare: "previous_period" }), cat, AS_OF, null);
    expect(c.previous?.params).toContain(336);
    expect(c.previous?.sql).toContain("<= (? - INTERVAL ? HOUR)");
  });
  it("keeps future rows out through the table's cap (IMD warnings for coming days)", () => {
    const c = compileQuery(q({ table: "observations" }), cat, AS_OF, null);
    expect(c.sql).toContain("b.`observed_at` <= ?");
  });
});
