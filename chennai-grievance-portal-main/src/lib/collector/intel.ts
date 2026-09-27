/**
 * Data for the Collector console, read from the district intelligence store
 * (`district_intel`, rebuilt by the pipeline) with the Collector's own decisions
 * from `district_intel_ops` laid on top. Every number on the console comes from
 * a query in this file.
 *
 * "Now" is the pipeline's as-of time (the newest record across sources), so the
 * period windows line up with the data even between builds.
 */
import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";

type Row = Record<string, any>;

async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await intelPool.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}

export const PERIODS = {
  daily: { hours: 24, buckets: 12, unit: "Day", prev: "prev. day", label: "Last 24 hours" },
  weekly: { hours: 168, buckets: 7, unit: "Week", prev: "prev. week", label: "Last 7 days" },
  monthly: { hours: 720, buckets: 30, unit: "Month", prev: "prev. month", label: "Last 30 days" },
  quarterly: { hours: 2160, buckets: 13, unit: "Quarter", prev: "prev. quarter", label: "Last 90 days" }
} as const;
export type Period = keyof typeof PERIODS;
export type Overview = Awaited<ReturnType<typeof overview>>;
export type Department = NonNullable<Awaited<ReturnType<typeof department>>>;
export type IncidentDetail = NonNullable<Awaited<ReturnType<typeof incident>>>;

export function parsePeriod(v: unknown): Period {
  return typeof v === "string" && v in PERIODS ? (v as Period) : "daily";
}
export function parseZone(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : null;
}
export function parseDept(v: unknown): string | null {
  return typeof v === "string" && /^[A-Z0-9-]{2,20}$/.test(v) ? v : null;
}

/** Status of an incident for the console's stage chips. */
export const OPEN_STATUSES = ["Open", "Under review", "Assigned", "In progress", "Awaiting verification"];

// ------------------------------------------------------------------ time --

let asOfCache: { at: number; value: string } | null = null;

/** Pipeline as-of time as an IST wall-clock string "YYYY-MM-DD HH:MM:SS". */
export async function asOf(): Promise<string> {
  if (asOfCache && Date.now() - asOfCache.at < 30_000) return asOfCache.value;
  const [r] = await q(`SELECT JSON_UNQUOTE(value) AS v FROM metrics WHERE metric = 'as_of'`);
  const v = r?.v ? String(r.v).slice(0, 19).replace("T", " ") : "";
  const value = v || (await q(`SELECT DATE_FORMAT(MAX(first_reported_at), '%Y-%m-%d %H:%i:%s') AS v FROM incidents`))[0].v;
  asOfCache = { at: Date.now(), value };
  return value;
}

export async function exportMeta(): Promise<Record<string, string>> {
  const r = await q(`SELECT k, v FROM _export_meta`);
  return Object.fromEntries(r.map((x) => [x.k, x.v]));
}

// ------------------------------------------------------------- filters --

interface Scope {
  period: Period;
  zone: number | null;
  dept?: string | null;
  offset?: number; // 1 = the previous window
}

/** WHERE clause over `incidents i` for a period window, zone and department. */
function scopeWhere(s: Scope, now: string): { sql: string; params: unknown[] } {
  const h = PERIODS[s.period].hours;
  const off = s.offset ?? 0;
  const parts = [
    `i.first_reported_at > (? - INTERVAL ? HOUR)`,
    `i.first_reported_at <= (? - INTERVAL ? HOUR)`
  ];
  const params: unknown[] = [now, h * (off + 1), now, h * off];
  if (s.zone) {
    parts.push(`i.zone_no = ?`);
    params.push(s.zone);
  }
  if (s.dept) {
    parts.push(`i.lead_dept = ?`);
    params.push(s.dept);
  }
  return { sql: parts.join(" AND "), params };
}

const SEV_RANK = `FIELD(i.severity_level, 'Severe', 'High', 'Medium', 'Low')`;
const DECIDED = (decisions: string) =>
  `EXISTS (SELECT 1 FROM ${ops("collector_decisions")} d WHERE d.incident_id = i.incident_id AND d.decision IN (${decisions}))`;

/** Columns every incident row on the console carries. */
const ROW = `i.incident_id AS id, i.title, i.category_label AS type, i.category_code AS cat_code, i.family,
  i.lead_dept AS dept, dp.name AS dept_name, i.zone_no AS zone, i.zone_name, i.ward_no AS ward, i.place_text AS loc,
  i.lat, i.lon, i.severity_level AS sev, i.status_std AS status, i.is_open AS open, i.verified,
  i.citizen_complaints AS complaints, i.outlet_count AS outlets, i.sources, i.source_count, i.channels,
  DATE_FORMAT(i.first_reported_at, '%Y-%m-%d %H:%i:%s') AS t, i.summary, i.priority_score AS priority,
  i.sla_breached AS breached, i.hours_open`;
const FROM = `FROM incidents i LEFT JOIN ref_departments dp ON dp.code = i.lead_dept`;

/** Latest Collector decision per incident, to overlay on pipeline status. */
async function decisionsFor(ids: string[]): Promise<Record<string, Row>> {
  if (!ids.length) return {};
  const r = await q(
    `SELECT incident_id, decision, escalate_to, note, decided_by,
            DATE_FORMAT(decided_at, '%Y-%m-%d %H:%i:%s') AS decided_at FROM (
       SELECT d.*, ROW_NUMBER() OVER (PARTITION BY incident_id ORDER BY decision_id DESC) rn
       FROM ${ops("collector_decisions")} d WHERE incident_id IN (?) AND decision <> 'note') x
     WHERE rn = 1`,
    [ids]
  );
  return Object.fromEntries(r.map((d) => [d.incident_id, d]));
}

async function withDecisions<T extends Row>(rows: T[]): Promise<T[]> {
  const dec = await decisionsFor(rows.map((r) => r.id));
  return rows.map((r) => overlay(r, dec[r.id]));
}

function overlay<T extends Row>(r: T, d: Row | undefined): T {
  if (!d) return r;
  const out: Row = { ...r, decision: d.decision, decided_at: d.decided_at };
  if (d.decision === "verify") out.verified = 1;
  if (d.decision === "escalate") out.escalated = 1;
  if (d.decision === "resolve") Object.assign(out, { open: 0, status: "Resolved", verified: 1 });
  if (d.decision === "reject") Object.assign(out, { open: 0, status: "Rejected" });
  if (d.decision === "reopen") Object.assign(out, { open: 1, status: "Open" });
  return out as T;
}

// ------------------------------------------------------------- overview --

function bucketSeries(rows: Row[], n: number, key: string): number[] {
  const out = Array(n).fill(0);
  for (const r of rows) {
    const b = Math.min(n - 1, Math.max(0, Number(r.b)));
    out[b] += Number(r[key] ?? 0);
  }
  return out;
}

async function kpiBlock(s: Scope, now: string, kind: "overview" | "dept") {
  const p = PERIODS[s.period];
  const cur = scopeWhere(s, now);
  const prev = scopeWhere({ ...s, offset: 1 }, now);
  const cols =
    kind === "overview"
      ? `SUM(i.severity_level = 'Severe') AS severe, SUM(CASE WHEN i.is_open = 1 THEN i.citizen_complaints ELSE 0 END) AS complaints,
         SUM(i.is_open) AS ongoing, SUM(i.is_open = 0 AND i.status_std = 'Resolved') AS resolved`
      : `SUM(i.is_open) AS open, SUM(i.is_open = 1 AND i.verified = 1) AS verified,
         SUM(i.is_open = 1 AND i.severity_level = 'Severe') AS severe, SUM(i.is_open = 0 AND i.status_std = 'Resolved') AS resolved`;
  const bucketSecs = (p.hours * 3600) / p.buckets;
  const [c, pv, series] = await Promise.all([
    q(`SELECT ${cols} FROM incidents i WHERE ${cur.sql}`, cur.params),
    q(`SELECT ${cols} FROM incidents i WHERE ${prev.sql}`, prev.params),
    q(
      `SELECT FLOOR(TIMESTAMPDIFF(SECOND, ? - INTERVAL ? HOUR, i.first_reported_at) / ?) AS b, ${cols}
       FROM incidents i WHERE ${cur.sql} GROUP BY b`,
      [now, p.hours, bucketSecs, ...cur.params]
    )
  ]);
  const keys = Object.keys(c[0] ?? {});
  const num = (r: Row | undefined) => Object.fromEntries(keys.map((k) => [k, Number(r?.[k] ?? 0)]));
  return {
    cur: num(c[0]),
    prev: num(pv[0]),
    series: Object.fromEntries(keys.map((k) => [k, bucketSeries(series, p.buckets, k)]))
  };
}

export async function overview(period: Period, zone: number | null) {
  const now = await asOf();
  const s: Scope = { period, zone };
  const w = scopeWhere(s, now);
  const p = PERIODS[period];

  const all = scopeWhere({ period, zone: null }, now);
  const [kpi, meta, zoneTable, pins, layerCounts, news, tasks, taskCount, recent, priority, byDept, byZone,
    feeds, bell, deptNav, snap, backlog] = await Promise.all([
    kpiBlock(s, now, "overview"),
    exportMeta(),
    q(
      `SELECT i.zone_no AS zone, i.zone_name AS name, COUNT(*) AS n, SUM(i.is_open) AS open,
              SUM(CASE WHEN i.is_open = 1 THEN i.citizen_complaints ELSE 0 END) AS complaints,
              SUM(i.severity_level = 'Severe') AS severe
       FROM incidents i WHERE ${all.sql} AND i.zone_no IS NOT NULL GROUP BY i.zone_no, i.zone_name ORDER BY i.zone_no`,
      all.params
    ),
    q(
      `SELECT i.incident_id AS id, i.lat, i.lon, i.severity_level AS sev, i.is_open AS open, i.citizen_complaints AS complaints,
              i.title, i.status_std AS status, DATE_FORMAT(i.first_reported_at, '%Y-%m-%d %H:%i:%s') AS t
       FROM incidents i WHERE ${w.sql} AND i.lat IS NOT NULL
       ORDER BY i.is_open DESC, ${SEV_RANK}, i.citizen_complaints DESC, i.first_reported_at DESC LIMIT ?`,
      [...w.params, zone ? 60 : 90]
    ),
    q(
      `SELECT SUM(i.severity_level = 'Severe') AS severe,
              SUM(i.severity_level <> 'Severe' AND i.citizen_complaints > 0) AS complaint,
              SUM(i.severity_level <> 'Severe' AND i.citizen_complaints = 0) AS other
       FROM incidents i WHERE ${w.sql}`,
      w.params
    ),
    q(
      `SELECT ${ROW} ${FROM} WHERE ${w.sql} AND i.outlet_count > 0 ORDER BY i.first_reported_at DESC LIMIT 20`,
      w.params
    ),
    q(
      `SELECT ${ROW} ${FROM}
       WHERE i.is_open = 1 AND i.verified = 0 AND i.first_reported_at > (? - INTERVAL 14 DAY)
         ${zone ? "AND i.zone_no = ?" : ""} AND NOT ${DECIDED("'verify','reject','resolve'")}
       ORDER BY ${SEV_RANK}, i.citizen_complaints DESC, i.first_reported_at DESC LIMIT 6`,
      zone ? [now, zone] : [now]
    ),
    q(
      `SELECT COUNT(*) AS n FROM incidents i
       WHERE i.is_open = 1 AND i.verified = 0 AND i.first_reported_at > (? - INTERVAL 14 DAY)
         ${zone ? "AND i.zone_no = ?" : ""} AND NOT ${DECIDED("'verify','reject','resolve'")}`,
      zone ? [now, zone] : [now]
    ),
    q(
      `(SELECT ${ROW} ${FROM} WHERE ${w.sql} AND FIND_IN_SET('grievance', REPLACE(i.sources, '|', ',')) ORDER BY i.first_reported_at DESC LIMIT 8)
       UNION ALL
       (SELECT ${ROW} ${FROM} WHERE ${w.sql} AND i.outlet_count > 0 ORDER BY i.first_reported_at DESC LIMIT 8)
       UNION ALL
       (SELECT ${ROW} ${FROM} WHERE ${w.sql} ORDER BY i.first_reported_at DESC LIMIT 8)`,
      [...w.params, ...w.params, ...w.params]
    ),
    q(
      `SELECT ${ROW} ${FROM} WHERE ${w.sql} AND i.is_open = 1
       ORDER BY ${SEV_RANK}, i.citizen_complaints DESC, i.first_reported_at DESC LIMIT ${zone ? 8 : 3}`,
      w.params
    ),
    q(
      `SELECT i.lead_dept AS code, dp.name, SUM(i.citizen_complaints) AS v ${FROM} WHERE ${w.sql}
       GROUP BY i.lead_dept, dp.name HAVING v > 0 ORDER BY v DESC`,
      w.params
    ),
    zone
      ? q(
          `SELECT i.place_text AS l, SUM(i.citizen_complaints) AS v FROM incidents i WHERE ${w.sql} AND i.is_open = 1
           AND i.place_text IS NOT NULL GROUP BY i.place_text HAVING v > 0 ORDER BY v DESC LIMIT 5`,
          w.params
        )
      : q(
          `SELECT i.zone_no AS zone, i.zone_name AS l, SUM(i.citizen_complaints) AS v FROM incidents i WHERE ${w.sql}
           AND i.is_open = 1 AND i.zone_no IS NOT NULL GROUP BY i.zone_no, i.zone_name HAVING v > 0 ORDER BY v DESC LIMIT 5`,
          w.params
        ),
    q(
      `SELECT source, kind, status, minutes_since_success, \`rows\` AS row_count,
              DATE_FORMAT(newest_record_at, '%Y-%m-%d %H:%i:%s') AS newest
       FROM source_health ORDER BY FIELD(source, 'grievance', 'police', 'pwd', 'hospital', 'news', 'imd', 'cpcb', 'cfm')`
    ),
    q(
      `SELECT ${ROW} ${FROM} WHERE i.is_open = 1 AND i.severity_level IN ('Severe', 'High')
       AND i.first_reported_at > (? - INTERVAL 24 HOUR) ORDER BY ${SEV_RANK}, i.citizen_complaints DESC LIMIT 6`,
      [now]
    ),
    q(
      `SELECT i.lead_dept AS code, dp.name, dp.head, SUM(i.is_open) AS open, COUNT(*) AS n,
              SUM(i.severity_level = 'Severe') AS severe,
              SUM(i.is_open = 1 AND i.verified = 0 AND i.first_reported_at > (? - INTERVAL 14 DAY)) AS unverified
       ${FROM} WHERE ${w.sql} GROUP BY i.lead_dept, dp.name, dp.head ORDER BY open DESC, n DESC`,
      [now, ...w.params]
    ),
    zone ? areaSnapshot(zone, s, now) : districtSnapshot(s, now),
    q(
      `SELECT i.lead_dept AS code, dp.name, AVG(i.hours_open) AS h, COUNT(*) AS n ${FROM}
       WHERE i.is_open = 1 ${zone ? "AND i.zone_no = ?" : ""} GROUP BY i.lead_dept, dp.name HAVING n >= 5 ORDER BY h DESC LIMIT 1`,
      zone ? [zone] : []
    )
  ]);

  // One list per Recent tab, de-duplicated client side.
  const recentRows = await withDecisions(recent);
  const [taskRows, newsRows, priorityRows, bellRows] = await Promise.all([
    withDecisions(tasks),
    withDecisions(news),
    withDecisions(priority),
    withDecisions(bell)
  ]);
  const [outlets, timelines] = await Promise.all([
    outletsFor(newsRows.map((r) => r.id)),
    timelinesFor(priorityRows.map((r) => r.id))
  ]);

  return {
    now,
    period,
    zone,
    exportedAt: meta.exported_at ?? null,
    kpi,
    zoneTable: zoneTable.map((z) => ({ zone: z.zone, name: z.name, n: Number(z.n), open: Number(z.open),
      complaints: Number(z.complaints), severe: Number(z.severe) })),
    backlog: backlog[0] ? { code: backlog[0].code, name: backlog[0].name, hours: Number(backlog[0].h), n: Number(backlog[0].n) } : null,
    map: {
      zoneCounts: Object.fromEntries(zoneTable.map((z) => [z.zone, Number(z.n)])),
      pins: pins.map((r) => ({
        ...r,
        cat: r.sev === "Severe" ? "severe" : Number(r.complaints) > 0 ? "complaint" : "other"
      })),
      layerCounts: {
        severe: Number(layerCounts[0]?.severe ?? 0),
        complaint: Number(layerCounts[0]?.complaint ?? 0),
        other: Number(layerCounts[0]?.other ?? 0)
      }
    },
    snapshot: snap,
    news: newsRows.map((r) => ({ ...r, outletNames: outlets[r.id] ?? [] }) as Row),
    tasks: { rows: taskRows, count: Number(taskCount[0]?.n ?? 0) },
    recent: recentRows,
    priority: priorityRows.map((r) => ({ ...r, timeline: timelines[r.id] ?? [] }) as Row),
    bottom: {
      byDept: byDept.map((r) => ({ code: r.code, l: r.name ?? r.code, v: Number(r.v) })),
      byZone: byZone.map((r) => ({ zone: r.zone ?? null, l: r.l, v: Number(r.v) })),
      ...(await environment(period, now))
    },
    feeds,
    bell: bellRows,
    deptNav: deptNav.map((d) => ({ code: d.code, name: d.name ?? d.code, head: d.head, open: Number(d.open), n: Number(d.n),
      severe: Number(d.severe), unverified: Number(d.unverified) })),
    periodInfo: p
  };
}

async function districtSnapshot(s: Scope, now: string) {
  const w = scopeWhere(s, now);
  const [top, depts, crit, zones] = await Promise.all([
    q(
      `SELECT i.zone_no AS zone, i.zone_name AS name,
              SUM(CASE i.severity_level WHEN 'Severe' THEN 3 WHEN 'High' THEN 1 ELSE 0 END) AS score
       FROM incidents i WHERE ${w.sql} AND i.zone_no IS NOT NULL GROUP BY i.zone_no, i.zone_name
       HAVING score > 0 ORDER BY score DESC LIMIT 2`,
      w.params
    ),
    q(`SELECT COUNT(DISTINCT i.lead_dept) AS n FROM incidents i WHERE ${w.sql} AND i.is_open = 1`, w.params),
    q(
      `SELECT COUNT(*) AS n FROM incidents i WHERE i.is_open = 1 AND i.severity_level = 'Severe'
       AND (i.verified = 0 OR i.awaiting_collector = 1) AND NOT ${DECIDED("'verify','reject','resolve'")}`
    ),
    q(`SELECT COUNT(DISTINCT zone_no) AS n FROM ref_wards`)
  ]);
  return {
    kind: "district" as const,
    zones: Number(zones[0]?.n ?? 0),
    topZones: top.map((t) => ({ zone: t.zone, name: t.name })),
    activeDepts: Number(depts[0]?.n ?? 0),
    critical: Number(crit[0]?.n ?? 0)
  };
}

async function areaSnapshot(zone: number, s: Scope, now: string) {
  const w = scopeWhere(s, now);
  const [k, keyDept, latest] = await Promise.all([
    q(
      `SELECT SUM(i.is_open) AS active, SUM(CASE WHEN i.is_open = 1 THEN i.citizen_complaints ELSE 0 END) AS complaints,
              SUM(i.severity_level = 'Severe') AS severe FROM incidents i WHERE ${w.sql}`,
      w.params
    ),
    q(
      `SELECT i.lead_dept AS code, dp.name, dp.head, COUNT(*) AS n ${FROM}
       WHERE i.zone_no = ? AND i.is_open = 1 GROUP BY i.lead_dept, dp.name, dp.head ORDER BY n DESC LIMIT 1`,
      [zone]
    ),
    q(
      `SELECT DATE_FORMAT(t.at, '%Y-%m-%d %H:%i:%s') AS at, t.step, t.note, i.title
       FROM incident_timeline t JOIN incidents i ON i.incident_id = t.incident_id
       WHERE i.zone_no = ? AND i.is_open = 1 AND t.at <= ? ORDER BY t.at DESC LIMIT 1`,
      [zone, now]
    )
  ]);
  return {
    kind: "area" as const,
    active: Number(k[0]?.active ?? 0),
    complaints: Number(k[0]?.complaints ?? 0),
    severe: Number(k[0]?.severe ?? 0),
    keyDept: keyDept[0] ?? null,
    latest: latest[0] ?? null
  };
}

async function outletsFor(ids: string[]): Promise<Record<string, string[]>> {
  if (!ids.length) return {};
  const r = await q(
    `SELECT DISTINCT linked_incident_id AS id, publisher FROM documents WHERE linked_incident_id IN (?) AND publisher IS NOT NULL`,
    [ids]
  );
  const out: Record<string, string[]> = {};
  for (const x of r) (out[x.id] ||= []).push(x.publisher);
  return out;
}

async function timelinesFor(ids: string[]): Promise<Record<string, Row[]>> {
  if (!ids.length) return {};
  const r = await q(
    `SELECT incident_id AS id, DATE_FORMAT(at, '%Y-%m-%d %H:%i:%s') AS t, step AS label, note, actor
     FROM incident_timeline WHERE incident_id IN (?) ORDER BY at, step`,
    [ids]
  );
  const out: Record<string, Row[]> = {};
  for (const x of r) (out[x.id] ||= []).push(x);
  return out;
}

/** Rain, air quality and reservoir storage for the bottom cards. */
async function environment(period: Period, now: string) {
  const days = Math.max(7, Math.round(PERIODS[period].hours / 24));
  const [rainDays, rainNow, aqi, lakes] = await Promise.all([
    q(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, rain_intensity AS v, rain_event AS ev FROM world_calendar
       WHERE date > DATE(?) - INTERVAL ? DAY AND date <= DATE(?) ORDER BY date`,
      [now, days * 2, now]
    ),
    q(
      `SELECT place_name, DATE_FORMAT(observed_at, '%Y-%m-%d %H:%i:%s') AS t, value FROM observations
       WHERE metric = 'rainfall_24h_mm' ORDER BY observed_at DESC, value DESC LIMIT 4`
    ),
    q(
      `SELECT DATE_FORMAT(observed_at, '%Y-%m-%d %H:%i:%s') AS t, ROUND(AVG(value)) AS v, MAX(value) AS worst
       FROM observations WHERE metric = 'aqi' GROUP BY observed_at ORDER BY observed_at DESC LIMIT 30`
    ),
    q(
      `SELECT DATE_FORMAT(observed_at, '%Y-%m-%d') AS d, AVG(value) AS v, COUNT(DISTINCT place_id) AS n FROM observations
       WHERE metric = 'lake_pct_full' AND observed_at > ? - INTERVAL ? DAY GROUP BY DATE(observed_at), d ORDER BY d`,
      [now, days]
    )
  ]);
  const cur = rainDays.slice(-days);
  const prev = rainDays.slice(0, Math.max(0, rainDays.length - days));
  const sum = (a: Row[]) => a.reduce((s, r) => s + Number(r.v), 0);
  const latestMm = rainNow.length ? Math.max(...rainNow.map((r) => Number(r.value))) : null;
  return {
    rain: {
      series: cur.map((r) => Number(r.v)),
      days: cur.map((r) => r.d),
      rainDays: cur.filter((r) => Number(r.ev)).length,
      prevRainDays: prev.filter((r) => Number(r.ev)).length,
      index: sum(cur),
      prevIndex: sum(prev),
      latestMm,
      latestAt: rainNow[0]?.t ?? null
    },
    aqi: {
      series: aqi.reverse().map((r) => Number(r.v)),
      times: aqi.map((r) => r.t),
      latest: aqi.length ? Number(aqi[aqi.length - 1].v) : null,
      worst: aqi.length ? Number(aqi[aqi.length - 1].worst) : null
    },
    lakes: {
      series: lakes.map((r) => Math.round(Number(r.v) * 10) / 10),
      count: lakes.length ? Number(lakes[lakes.length - 1].n) : 0,
      days: lakes.map((r) => r.d)
    }
  };
}

// ----------------------------------------------------------- department --

export async function department(code: string, period: Period, zone: number | null) {
  const now = await asOf();
  const s: Scope = { period, zone, dept: code };
  const w = scopeWhere(s, now);

  const [info] = await q(`SELECT code, name, org, head, route FROM ref_departments WHERE code = ?`, [code]);
  if (!info) return null;

  const [kpi, sevCounts, pins, list, queue, queueCount, newsRows, offices, zoneOpen, trendRows, cats] = await Promise.all([
    kpiBlock(s, now, "dept"),
    q(`SELECT i.severity_level AS sev, COUNT(*) AS n FROM incidents i WHERE ${w.sql} GROUP BY i.severity_level`, w.params),
    q(
      `SELECT i.incident_id AS id, i.lat, i.lon, i.severity_level AS sev, i.is_open AS open, i.title, i.status_std AS status,
              DATE_FORMAT(i.first_reported_at, '%Y-%m-%d %H:%i:%s') AS t
       FROM incidents i WHERE ${w.sql} AND i.lat IS NOT NULL
       ORDER BY i.is_open DESC, ${SEV_RANK}, i.first_reported_at DESC LIMIT 80`,
      w.params
    ),
    q(`SELECT ${ROW} ${FROM} WHERE ${w.sql} ORDER BY i.is_open DESC, i.first_reported_at DESC LIMIT 400`, w.params),
    q(
      `SELECT ${ROW} ${FROM} WHERE i.lead_dept = ? AND i.is_open = 1 AND i.verified = 0
         AND i.first_reported_at > (? - INTERVAL 14 DAY) ${zone ? "AND i.zone_no = ?" : ""}
         AND NOT ${DECIDED("'verify','reject','resolve'")}
       ORDER BY ${SEV_RANK}, i.citizen_complaints DESC, i.first_reported_at DESC LIMIT 6`,
      zone ? [code, now, zone] : [code, now]
    ),
    q(
      `SELECT COUNT(*) AS n FROM incidents i WHERE i.lead_dept = ? AND i.is_open = 1 AND i.verified = 0
         AND i.first_reported_at > (? - INTERVAL 14 DAY) ${zone ? "AND i.zone_no = ?" : ""}
         AND NOT ${DECIDED("'verify','reject','resolve'")}`,
      zone ? [code, now, zone] : [code, now]
    ),
    q(
      `SELECT ${ROW} ${FROM} WHERE ${w.sql} AND i.is_open = 1 ORDER BY ${SEV_RANK}, i.citizen_complaints DESC LIMIT 5`,
      w.params
    ),
    q(
      `SELECT office_id, office_name, wing, officer_name, designation, phone, email FROM ref_offices WHERE dept_code = ?
       ORDER BY FIELD(designation, 'Chief Engineer', 'Superintending Engineer', 'Executive Engineer', 'Assistant Executive Engineer'), office_name`,
      [code]
    ),
    q(
      `SELECT w.zone_no AS zone, w.zone_name AS name, COALESCE(SUM(i.is_open), 0) AS open
       FROM (SELECT DISTINCT zone_no, zone_name FROM ref_wards) w
       LEFT JOIN incidents i ON i.zone_no = w.zone_no AND i.lead_dept = ? AND i.is_open = 1
       GROUP BY w.zone_no, w.zone_name ORDER BY open DESC`,
      [code]
    ),
    q(
      `SELECT FLOOR(TIMESTAMPDIFF(HOUR, ? - INTERVAL 84 DAY, i.first_reported_at) / 168) AS wk, i.category_label AS type, COUNT(*) AS n
       FROM incidents i WHERE i.lead_dept = ? AND i.first_reported_at > ? - INTERVAL 84 DAY AND i.first_reported_at <= ?
       ${zone ? "AND i.zone_no = ?" : ""} GROUP BY wk, type`,
      zone ? [now, code, now, now, zone] : [now, code, now, now]
    ),
    q(
      `SELECT i.category_label AS type, COUNT(*) AS n FROM incidents i WHERE i.lead_dept = ?
       AND i.first_reported_at > ? - INTERVAL 84 DAY GROUP BY type ORDER BY n DESC LIMIT 10`,
      [code, now]
    )
  ]);

  const weeks = Array.from({ length: 12 }, (_, k) => k);
  const trend: Record<string, number[]> = { all: weeks.map(() => 0) };
  for (const r of trendRows) {
    const k = Number(r.wk);
    if (k < 0 || k > 11) continue;
    (trend[r.type] ||= weeks.map(() => 0))[k] += Number(r.n);
    trend.all[k] += Number(r.n);
  }

  return {
    now,
    period,
    zone,
    dept: info,
    kpi,
    sevCounts: Object.fromEntries(sevCounts.map((r) => [r.sev, Number(r.n)])),
    pins,
    list: await withDecisions(list),
    queue: { rows: await withDecisions(queue), count: Number(queueCount[0]?.n ?? 0) },
    news: await withDecisions(newsRows),
    offices,
    zoneOpen: zoneOpen.map((z) => ({ ...z, open: Number(z.open) }) as Row),
    trend,
    trendTypes: cats.map((c) => c.type),
    periodInfo: PERIODS[period]
  };
}

// ------------------------------------------------------------- incident --

export async function incident(id: string) {
  const [inc] = await q(
    `SELECT ${ROW}, i.occurred_at_est, DATE_FORMAT(i.closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at,
            DATE_FORMAT(i.sla_due_at, '%Y-%m-%d %H:%i:%s') AS sla_due, i.officer, i.priority_reasons,
            i.attention_reason, i.severity_reasons, i.depts_involved, dp.head AS dept_head, dp.route AS dept_route
     ${FROM} WHERE i.incident_id = ?`,
    [id]
  );
  if (!inc) return null;

  const [members, timeline, actions, updates, documents, decisions] = await Promise.all([
    q(
      `SELECT m.event_id, m.source, m.source_record_id, m.channel, DATE_FORMAT(m.reported_at, '%Y-%m-%d %H:%i:%s') AS t,
              m.link_prob, m.link_method, m.deep_link, m.title, m.is_overlay, m.role, LEFT(e.text, 400) AS text
       FROM incident_members m LEFT JOIN events e ON e.event_id = m.event_id
       WHERE m.incident_id = ? ORDER BY m.reported_at LIMIT 60`,
      [id]
    ),
    q(
      `SELECT DATE_FORMAT(at, '%Y-%m-%d %H:%i:%s') AS t, step AS label, note, actor, source
       FROM incident_timeline WHERE incident_id = ? ORDER BY at, step`,
      [id]
    ),
    q(
      `SELECT action_id, dept_code, owner, text, status, origin, DATE_FORMAT(due_at, '%Y-%m-%d %H:%i:%s') AS due
       FROM actions WHERE incident_id = ? ORDER BY origin = 'pwd_task' DESC, assigned_at, action_id`,
      [id]
    ),
    q(
      `SELECT update_id, action_id, dept_code, owner, text, status, DATE_FORMAT(due_at, '%Y-%m-%d %H:%i:%s') AS due,
              updated_by, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
       FROM ${ops("action_updates")} WHERE incident_id = ? ORDER BY update_id`,
      [id]
    ),
    q(
      `SELECT doc_id, title, publisher, url, DATE_FORMAT(published_at, '%Y-%m-%d %H:%i:%s') AS t, lang, summary
       FROM documents WHERE linked_incident_id = ? ORDER BY published_at LIMIT 20`,
      [id]
    ),
    q(
      `SELECT decision_id, decision, escalate_to, note, decided_by, DATE_FORMAT(decided_at, '%Y-%m-%d %H:%i:%s') AS t
       FROM ${ops("collector_decisions")} WHERE incident_id = ? ORDER BY decision_id`,
      [id]
    )
  ]);

  // Action list = pipeline actions, then actions added by hand; the latest update wins.
  const acts: Row[] = actions.map((a) => ({ ...a, id: a.action_id, added: false }));
  for (const u of updates) {
    if (!u.action_id) {
      acts.push({ id: `OPS-${u.update_id}`, dept_code: u.dept_code, owner: u.owner, text: u.text, status: u.status || "Not started",
        due: u.due, origin: "collector", added: true });
    } else {
      const a = acts.find((x) => x.id === u.action_id);
      if (a && u.status) Object.assign(a, { status: u.status, updated_by: u.updated_by, updated_at: u.updated_at });
    }
  }

  // Collector steps join the pipeline timeline.
  const steps = [
    ...timeline,
    ...decisions.map((d) => ({
      t: d.t,
      label: DECISION_STEP[d.decision] ?? d.decision,
      note: d.note || (d.escalate_to ? `to ${d.escalate_to}` : null),
      actor: d.decided_by,
      source: "collector"
    }))
  ].sort((a, b) => String(a.t).localeCompare(String(b.t)));

  const last = decisions.filter((d) => d.decision !== "note").slice(-1)[0];
  return {
    incident: overlay(inc, last ? { ...last, decided_at: last.t } : undefined),
    members,
    timeline: steps,
    actions: acts,
    documents,
    decisions
  };
}

const DECISION_STEP: Record<string, string> = {
  verify: "Collector verified",
  escalate: "Escalated",
  reject: "Rejected by Collector",
  resolve: "Resolved by Collector",
  reopen: "Reopened",
  note: "Collector note"
};

// ------------------------------------------------------------ list modal --

export interface ListFilter {
  period: Period;
  zone: number | null;
  dept: string | null;
  sev: string | null;
  status: string | null;
  q: string | null;
  sort: "t" | "sev" | "c" | "r" | "d";
  dir: 1 | -1;
  page: number;
  scope: "period" | "all";
}

export async function list(f: ListFilter) {
  const now = await asOf();
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.scope === "period") {
    const w = scopeWhere({ period: f.period, zone: f.zone, dept: f.dept }, now);
    where.push(w.sql);
    params.push(...w.params);
  } else {
    where.push("i.first_reported_at <= ?");
    params.push(now);
    if (f.zone) (where.push("i.zone_no = ?"), params.push(f.zone));
    if (f.dept) (where.push("i.lead_dept = ?"), params.push(f.dept));
  }
  if (f.sev) (where.push("i.severity_level = ?"), params.push(f.sev));
  const st = f.status;
  if (st === "open") where.push("i.is_open = 1");
  else if (st === "unverified") where.push(`i.is_open = 1 AND i.verified = 0 AND NOT ${DECIDED("'verify','reject','resolve'")}`);
  else if (st === "verified") where.push("i.is_open = 1 AND i.verified = 1");
  else if (st === "critical")
    where.push(`i.is_open = 1 AND i.severity_level = 'Severe' AND (i.verified = 0 OR i.awaiting_collector = 1) AND NOT ${DECIDED("'verify','reject','resolve'")}`);
  else if (st) (where.push("i.status_std = ?"), params.push(st));
  if (f.q) {
    where.push("(i.title LIKE ? OR i.place_text LIKE ? OR i.incident_id LIKE ? OR i.zone_name LIKE ? OR i.category_label LIKE ?)");
    const like = `%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    params.push(like, like, like, like, like);
  }
  const order = {
    t: "i.first_reported_at",
    sev: SEV_RANK,
    c: "i.citizen_complaints",
    r: "i.zone_name",
    d: "dp.name"
  }[f.sort];
  const dir = f.dir < 0 ? "DESC" : "ASC";
  const W = where.join(" AND ");
  const [rows, tot] = await Promise.all([
    q(`SELECT ${ROW} ${FROM} WHERE ${W} ORDER BY ${order} ${dir}, i.first_reported_at DESC LIMIT 12 OFFSET ?`, [
      ...params,
      f.page * 12
    ]),
    q(`SELECT COUNT(*) AS n, COALESCE(SUM(i.citizen_complaints), 0) AS c ${FROM} WHERE ${W}`, params)
  ]);
  return { rows: await withDecisions(rows), total: Number(tot[0].n), complaints: Number(tot[0].c) };
}

// ---------------------------------------------------------------- search --

export async function search(text: string) {
  const like = `%${text.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const [zones, depts, incs] = await Promise.all([
    q(
      `SELECT w.zone_no AS zone, w.zone_name AS name, (SELECT COUNT(*) FROM incidents i WHERE i.zone_no = w.zone_no AND i.is_open = 1) AS open
       FROM (SELECT DISTINCT zone_no, zone_name FROM ref_wards) w WHERE w.zone_name LIKE ? ORDER BY w.zone_no LIMIT 4`,
      [like]
    ),
    q(
      `SELECT code, name, org FROM ref_departments WHERE action_owner = 1 AND (name LIKE ? OR code LIKE ?) LIMIT 3`,
      [like, like]
    ),
    q(
      `SELECT ${ROW} ${FROM} WHERE i.title LIKE ? OR i.place_text LIKE ? OR i.incident_id LIKE ?
       ORDER BY i.is_open DESC, i.first_reported_at DESC LIMIT 7`,
      [like, like, like]
    )
  ]);
  return { zones, depts, incidents: incs };
}

// ---------------------------------------------------------------- export --

export async function exportRows(period: Period, zone: number | null, dept: string | null) {
  const now = await asOf();
  const w = scopeWhere({ period, zone, dept }, now);
  return q(
    `SELECT i.incident_id AS id, i.category_label AS event, i.zone_name AS area, i.place_text AS location,
            dp.name AS department, i.severity_level AS severity, i.status_std AS status,
            i.citizen_complaints AS complaints, DATE_FORMAT(i.first_reported_at, '%Y-%m-%d %H:%i') AS reported
     ${FROM} WHERE ${w.sql} ORDER BY i.first_reported_at DESC LIMIT 5000`,
    w.params
  );
}

// ---------------------------------------------------------- departments --

/** Departments that own incidents, for the department picker and sidebar. */
export async function deptList() {
  return q<{ code: string; name: string; head: string | null }>(
    `SELECT d.code, d.name, d.head FROM ref_departments d
     WHERE d.action_owner = 1 AND EXISTS (SELECT 1 FROM incidents i WHERE i.lead_dept = d.code) ORDER BY d.name`
  );
}
