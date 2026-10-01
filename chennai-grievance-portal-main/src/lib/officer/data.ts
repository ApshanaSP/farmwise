/**
 * Data for the Department Officer console. Every query is scoped to one department:
 * the signed-in officer's, resolved on the server (see guard.ts), never taken from
 * the request. It reads the district intelligence store (`district_intel`, rebuilt by
 * the pipeline) and lays two things from `district_intel_ops` on top, the same way the
 * Collector console overlays its decisions:
 *
 *   officer_steps        approve / sent to the Collector
 *   collector_decisions  the Collector's verify / return (reopen) / resolve / reject
 *
 * The latest of those wins; without either, the pipeline's status decides the stage.
 * Every panel follows the period (the Collector's windows: Daily = today from midnight,
 * Weekly .. Quarterly = the last 7, 30, 90 days of reports) and the zone / taluk filter.
 * "Now" is the pipeline's as-of time, so the windows line up with the data. The data
 * itself is only what the pipeline's daily collection loads; nothing here fetches it.
 */
import { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import intelPool, { ops } from "@/lib/collector/db";
import { PERIODS, asOf, contactsFor, exportMeta, overview, periodSince, periodWindow, type Period } from "@/lib/collector/intel";
import { collectionStatus } from "@/lib/collector/sources";
import { OFFICER, deptConfig } from "./departments";
import { NEXT_STEP, STAGE_LABEL, TAB_STAGES, type Stage, type Tab } from "./stages";
import { photoUrl } from "./photos";

type Row = Record<string, any>;

async function q<T = Row>(sql: string, params: unknown[] = [], conn?: PoolConnection): Promise<T[]> {
  const [r] = await (conn ?? intelPool).query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}

const fmt = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:%s')`;

/** What the console is looking at: a period, and optionally one zone and one taluk. */
export interface Scope {
  period: Period;
  zone: number | null;
  taluk: string | null;
}

// ---------------------------------------------------------- department --

export interface DeptProfile {
  code: string;
  name: string;
  org: string;
  head: string;
  route: string;
  short: string;
  remarkHint: string;
}

const profileCache = new Map<string, { at: number; p: DeptProfile | null }>();

/** A department that owns work in the store, with its console configuration; null if unknown. */
export async function deptProfile(code: string): Promise<DeptProfile | null> {
  const hit = profileCache.get(code);
  if (hit && Date.now() - hit.at < 300_000) return hit.p;
  const [r] = await q(`SELECT code, name, org, head, route FROM ref_departments WHERE code = ? AND action_owner = 1`, [code]);
  const c = deptConfig(code);
  const clean = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "-" ? v.trim() : "");
  const p: DeptProfile | null = r
    ? { code, name: clean(r.name) || code, org: clean(r.org), head: clean(r.head) || "Head of department", route: clean(r.route), short: c.short, remarkHint: c.remarkHint }
    : null;
  profileCache.set(code, { at: Date.now(), p });
  return p;
}

// ------------------------------------------------------ stage overlay --

const STAGE_SQL = `CASE
    WHEN cd.decided_at IS NOT NULL AND (os.at IS NULL OR cd.decided_at >= os.at)
      THEN CASE cd.decision WHEN 'reopen' THEN 'action' WHEN 'reject' THEN 'closed' ELSE 'verified' END
    WHEN os.step = 'send' THEN 'sent'
    WHEN os.step = 'action' THEN 'action'
    WHEN os.step = 'approve' THEN 'approved'
    WHEN i.status_std IN ('Open', 'Under review') THEN 'new'
    WHEN i.status_std = 'Assigned' THEN 'approved'
    WHEN i.status_std = 'In progress' THEN 'action'
    WHEN i.status_std = 'Awaiting verification' THEN 'sent'
    WHEN i.status_std = 'Resolved' THEN 'verified'
    ELSE 'closed' END`;

/**
 * `WITH ... w AS (...)`: the department's incidents with their workflow stage. Callers
 * append `SELECT ... FROM w WHERE ...`.
 */
function withStage(dept: string, now: string) {
  return {
    sql: `WITH os AS (
        SELECT incident_id, step, at FROM (
          SELECT s.incident_id, s.step, s.at, ROW_NUMBER() OVER (PARTITION BY s.incident_id ORDER BY s.at DESC, s.step_id DESC) AS rn
          FROM ${ops("officer_steps")} s WHERE s.dept_code = ?) x WHERE rn = 1),
      ls AS (SELECT incident_id, MAX(at) AS at FROM ${ops("officer_steps")} WHERE dept_code = ? AND step = 'send' GROUP BY incident_id),
      cd AS (
        SELECT incident_id, decision, decided_at, note FROM (
          SELECT d.incident_id, d.decision, d.decided_at, d.note,
                 ROW_NUMBER() OVER (PARTITION BY d.incident_id ORDER BY d.decided_at DESC, d.decision_id DESC) AS rn
          FROM ${ops("collector_decisions")} d JOIN incidents di ON di.incident_id = d.incident_id AND di.lead_dept = ?
          WHERE d.decision IN ('verify', 'reopen', 'resolve', 'reject')) x WHERE rn = 1),
      w AS (
        SELECT i.incident_id, i.title, i.category_label, i.category_code, i.zone_no, i.zone_name, i.ward_no, i.taluk_code, i.place_text,
               i.lat, i.lon, i.severity_level, i.status_std, i.citizen_complaints, i.outlet_count, i.sources, i.source_count, i.officer,
               i.summary, i.media_only, i.first_reported_at, i.sla_due_at, i.closed_at, i.sla_breached, i.is_open,
               ${STAGE_SQL} AS stage,
               (cd.decision = 'reopen' AND (ls.at IS NULL OR ls.at < cd.decided_at)) AS returned,
               cd.note AS c_note, cd.decision AS c_decision, cd.decided_at AS c_at,
               GREATEST(i.last_update_at, COALESCE(os.at, i.last_update_at), COALESCE(cd.decided_at, i.last_update_at)) AS upd
        FROM incidents i
        LEFT JOIN os ON os.incident_id = i.incident_id
        LEFT JOIN ls ON ls.incident_id = i.incident_id
        LEFT JOIN cd ON cd.incident_id = i.incident_id
        WHERE i.lead_dept = ? AND i.first_reported_at <= ?)`,
    params: [dept, dept, dept, dept, now] as unknown[]
  };
}

/** Grievances reported in the period (the Collector's windows), in the chosen zone / taluk; closed ones never. */
function windowWhere(now: string, s: Scope) {
  const pw = periodWindow(s.period, now, "w.first_reported_at");
  return {
    sql: `${pw.sql} AND w.stage <> 'closed'${s.zone ? " AND w.zone_no = ?" : ""}${s.taluk ? " AND w.taluk_code = ?" : ""}`,
    params: [...pw.params, ...(s.zone ? [s.zone] : []), ...(s.taluk ? [s.taluk] : [])] as unknown[]
  };
}
/** The Collector's snapshot tiles: open and severe or high; open and past the deadline. */
const FLAG_SQL = {
  open: `w.stage IN ('new', 'approved', 'action', 'sent')`,
  serious: `w.stage IN ('new', 'approved', 'action', 'sent') AND w.severity_level IN ('Severe', 'High')`,
  overdue: `w.stage IN ('new', 'approved', 'action', 'sent') AND w.sla_breached = 1`
} as const;
/** Open, not yet past the deadline, and due within the next 24 hours of `now` (params: now, now). */
const DUE_SQL = `w.stage IN ('new', 'approved', 'action', 'sent') AND COALESCE(w.sla_breached, 0) = 0 AND w.sla_due_at > ? AND w.sla_due_at <= ? + INTERVAL 1 DAY`;
export type ListFlagKey = keyof typeof FLAG_SQL | "due";

const ROW = `w.incident_id AS id, w.title, w.category_label AS type, w.category_code AS cat, w.zone_no AS zone, w.zone_name,
  w.ward_no AS ward, w.taluk_code AS taluk, w.place_text AS loc, w.lat, w.lon, w.severity_level AS sev, w.status_std AS status, w.stage,
  w.returned, w.c_note AS returnNote, w.citizen_complaints AS complaints, w.outlet_count AS outlets, w.sources, w.source_count, w.officer,
  ${fmt("w.first_reported_at")} AS t, ${fmt("w.upd")} AS updated, ${fmt("w.sla_due_at")} AS due_at`;
const SEV_ORDER = `FIELD(w.severity_level, 'Severe', 'High', 'Medium', 'Low')`;
const OPEN_STAGES = `('new', 'approved', 'action', 'sent')`;

function tidy<T extends Row>(r: T): T {
  return { ...r, returned: Number(r.returned) === 1, complaints: Number(r.complaints ?? 0), outlets: Number(r.outlets ?? 0) };
}

// ----------------------------------------------------------- geography --

let geoCache: { at: number; zones: { zone: number; name: string; taluks: string[] }[]; taluks: { code: string; name: string }[] } | null = null;

/** Zones, and the taluks each zone's wards fall in (a taluk can span zones). */
async function zonesAndTaluks() {
  if (geoCache && Date.now() - geoCache.at < 600_000) return geoCache;
  const r = await q(
    `SELECT w.zone_no AS zone, w.zone_name AS name, w.taluk_code AS code, t.name AS taluk
     FROM ref_wards w LEFT JOIN ref_taluks t ON t.taluk_code = w.taluk_code
     GROUP BY w.zone_no, w.zone_name, w.taluk_code, t.name ORDER BY w.zone_no, t.name`
  );
  const zones = new Map<number, { zone: number; name: string; taluks: string[] }>();
  const taluks = new Map<string, string>();
  for (const x of r) {
    const z = zones.get(Number(x.zone)) ?? { zone: Number(x.zone), name: String(x.name), taluks: [] };
    if (x.code) { z.taluks.push(String(x.code)); taluks.set(String(x.code), String(x.taluk ?? x.code)); }
    zones.set(z.zone, z);
  }
  geoCache = {
    at: Date.now(),
    zones: [...zones.values()],
    taluks: [...taluks.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
  };
  return geoCache;
}

// ------------------------------------------------------------- updates --

const FEED_LABEL: Record<string, string> = {
  grievance: "Citizen grievances", police: "Police records", pwd: "PWD records (lakes, works, field)", hospital: "Government hospitals (MIS)",
  news: "News monitor", imd: "IMD weather", cpcb: "CPCB air quality", cfm: "CFM-DSS flood monitor"
};

/**
 * When the dashboard data was last collected: the pipeline's daily 6:00 AM collection (the same
 * status the Collector console shows), with each feed's newest record. Falls back to the
 * store's export time if the pipeline's state file cannot be read.
 */
function refreshInfo(exportedAt: string | null, feeds: Row[]) {
  const cs = collectionStatus();
  const missing = new Set(cs?.missing ?? []);
  return {
    at: cs?.lastRun ?? exportedAt,
    status: cs ? (missing.size ? "partial" : "ok") : null,
    store: exportedAt ? `store rebuilt ${exportedAt.slice(0, 16)}` : null,
    sources: feeds.map((f) => ({
      source: String(f.source), label: FEED_LABEL[f.source] ?? String(f.source), newest: (f.newest as string | null) ?? null,
      failed: missing.has(f.source) ? "not collected in today's 6:00 AM run yet" : null
    }))
  };
}

// ------------------------------------------------------------ overview --

export async function officerOverview(dept: DeptProfile, s: Scope) {
  const now = await asOf();
  const b = withStage(dept.code, now);
  const win = windowWhere(now, s);
  const P = PERIODS[s.period];
  // trend buckets run from the start of the window (midnight for Daily), like the Collector's charts
  const since = periodSince(s.period, now);
  const bucketSecs = (P.hours * 3600) / P.buckets;
  // Open by area drills down with the filter: zones, then the zone's taluks, then the taluk's wards.
  const level: "zone" | "taluk" | "ward" = s.taluk ? "ward" : s.zone ? "taluk" : "zone";
  const areaKey = level === "zone" ? "w.zone_no" : level === "taluk" ? "w.taluk_code" : "w.ward_no";
  const areaLabel = level === "zone" ? "w.zone_name" : level === "taluk" ? "COALESCE(tk.name, w.taluk_code)" : "CONCAT('Ward ', w.ward_no)";

  const [counts, pins, byZone, byArea, byType, news, trend, feedback, geo, meta, feeds, contacts, oldest, board, qNew, qAction] = await Promise.all([
    q(`${b.sql} SELECT SUM(stage = 'new') AS new, SUM(stage IN ('approved', 'action')) AS action, SUM(stage = 'sent') AS sent,
         SUM(stage = 'verified') AS verified, SUM(stage IN ('approved', 'action') AND returned) AS returned,
         SUM(${FLAG_SQL.serious}) AS serious, SUM(${FLAG_SQL.overdue}) AS overdue,
         SUM(stage = 'new' AND severity_level IN ('Severe', 'High')) AS new_serious, SUM(${DUE_SQL}) AS due FROM w WHERE ${win.sql}`,
      [...b.params, now, now, ...win.params]),
    q(`${b.sql} SELECT w.incident_id AS id, w.lat, w.lon, w.severity_level AS sev, w.title, w.stage, 1 AS open
       FROM w WHERE ${win.sql} AND w.stage IN ${OPEN_STAGES} AND w.lat IS NOT NULL
       ORDER BY ${SEV_ORDER}, w.first_reported_at DESC LIMIT ${OFFICER.mapPins}`, [...b.params, ...win.params]),
    q(`${b.sql} SELECT w.zone_no AS zone, COUNT(*) AS v FROM w WHERE ${win.sql} AND w.stage IN ${OPEN_STAGES} AND w.zone_no IS NOT NULL
       GROUP BY w.zone_no`, [...b.params, ...win.params]),
    q(`${b.sql} SELECT ${areaKey} AS k, ${areaLabel} AS l, COUNT(*) AS v FROM w LEFT JOIN ref_taluks tk ON tk.taluk_code = w.taluk_code
       WHERE ${win.sql} AND w.stage IN ${OPEN_STAGES} AND ${areaKey} IS NOT NULL GROUP BY k, l ORDER BY v DESC LIMIT ${OFFICER.areaBars}`,
      [...b.params, ...win.params]),
    q(`${b.sql} SELECT w.category_code AS code, w.category_label AS l, COUNT(*) AS v
       FROM w WHERE ${win.sql} GROUP BY w.category_code, w.category_label ORDER BY v DESC`, [...b.params, ...win.params]),
    q(`${b.sql} SELECT ${ROW}, w.summary FROM w WHERE ${win.sql} AND w.outlet_count > 0
       ORDER BY w.first_reported_at DESC LIMIT ${OFFICER.newsItems}`, [...b.params, ...win.params]),
    // grievances reported per bucket and category, for the trend chart (the same set as the counts and by type)
    q(`${b.sql} SELECT w.category_code AS code, w.category_label AS l, FLOOR(TIMESTAMPDIFF(SECOND, ?, w.first_reported_at) / ?) AS b, COUNT(*) AS n
       FROM w WHERE ${win.sql} AND w.first_reported_at <= ?
       GROUP BY w.category_code, w.category_label, b`,
      [...b.params, since, bucketSecs, ...win.params, now]),
    collectorFeedback(dept.code, s, OFFICER.feedbackItems),
    zonesAndTaluks(),
    exportMeta(),
    q(`SELECT source, status, ${fmt("newest_record_at")} AS newest FROM source_health
       ORDER BY FIELD(source, 'grievance', 'police', 'pwd', 'hospital', 'news', 'imd', 'cpcb', 'cfm')`),
    contactsFor(dept.code, s.zone).catch(() => [] as Row[]),
    // the open grievance waiting longest, for the officer's priorities
    q(`${b.sql} SELECT ${ROW} FROM w WHERE ${win.sql} AND w.stage IN ${OPEN_STAGES} ORDER BY w.first_reported_at, w.incident_id LIMIT 1`, [...b.params, ...win.params]),
    deptBoard(dept.code, s),
    // the officer's work queue on the first page: what to approve, and what is in action (most severe first)
    grievanceList(dept, { ...s, tab: "new", page: 0, per: 8, cat: null, q: null }),
    grievanceList(dept, { ...s, tab: "action", page: 0, per: 8, cat: null, q: null })
  ]);

  const c = counts[0] ?? {};
  const outlets = await outletsFor(news.map((r) => r.id));
  const updated = refreshInfo(meta.exported_at ?? null, feeds);
  const series = new Map<string, { code: string; l: string; v: number[] }>();
  for (const r of trend) {
    const k = Math.min(P.buckets - 1, Math.max(0, Number(r.b)));
    const x = series.get(r.code) ?? { code: r.code, l: r.l, v: Array(P.buckets).fill(0) };
    x.v[k] += Number(r.n);
    series.set(r.code, x);
  }
  const zoneTop = [...byZone].sort((a, b2) => Number(b2.v) - Number(a.v))[0];

  return {
    now,
    since,
    period: s.period,
    periodInfo: P,
    zone: s.zone,
    taluk: s.taluk,
    dept,
    exportedAt: meta.exported_at ?? null,
    /** the pipeline's daily collection: when it last ran, and each feed's newest record */
    updated,
    counts: {
      new: Number(c.new ?? 0), action: Number(c.action ?? 0), sent: Number(c.sent ?? 0), verified: Number(c.verified ?? 0),
      returned: Number(c.returned ?? 0), serious: Number(c.serious ?? 0), overdue: Number(c.overdue ?? 0),
      /** new and severe or high: approve these first */
      newSerious: Number(c.new_serious ?? 0),
      /** open and due within the next 24 hours */
      due: Number(c.due ?? 0)
    },
    oldest: oldest[0] ? tidy(oldest[0]) : null,
    /** the department head (GCC who's who) and the zone with the most open work, as in the Collector's department snapshot */
    head: (contacts.find((x) => x.dept_code === dept.code) ?? null) as Row | null,
    topZone: zoneTop
      ? { zone: Number(zoneTop.zone), name: geo.zones.find((z) => z.zone === Number(zoneTop.zone))?.name ?? `Zone ${zoneTop.zone}`, n: Number(zoneTop.v) }
      : null,
    map: {
      pins: pins.map((p): Row => ({ ...p, cat: p.sev })),
      zoneCounts: Object.fromEntries(byZone.map((z) => [z.zone, Number(z.v)])),
      sevCounts: ["Severe", "High", "Medium", "Low"].map((sv) => ({ sev: sv, n: pins.filter((p) => p.sev === sv).length }))
    },
    byType: byType.map((r) => ({ code: r.code as string, l: String(r.l ?? r.code), v: Number(r.v) })),
    byArea: { level, rows: byArea.map((r) => ({ key: String(r.k), l: String(r.l), v: Number(r.v) })) },
    news: news.map((r): Row => ({ ...tidy(r), outletNames: outlets[r.id] ?? [] })),
    /** one count per bucket (P.buckets across the period from `since`), oldest first */
    trend: [...series.values()].sort((a, b2) => b2.v.reduce((x, y) => x + y, 0) - a.v.reduce((x, y) => x + y, 0)),
    feedback,
    zones: geo.zones,
    taluks: geo.taluks,
    /** every department has an insights page: its own work record, plus the store's data that concerns it */
    hasData: true,
    feeds: feeds.map((f) => ({ source: String(f.source), status: String(f.status), newest: f.newest as string | null })),
    /** the Collector console's overview with this department as its filter: the same headline numbers, map, snapshot, severity and news */
    board,
    /** the first rows of New and In action, for the first page's work queue */
    queue: { new: qNew.rows, action: qAction.rows }
  };
}
export type OfficerOverview = Awaited<ReturnType<typeof officerOverview>>;

/**
 * The Collector console's own overview, filtered to the department (and the officer's zone / taluk), so the
 * officer's first page shows exactly what the Collector sees with that department selected. Read-only: the
 * news routing the Collector console does on load is not repeated here.
 */
async function deptBoard(dept: string, s: Scope) {
  const d = await overview(s.period, s.zone, dept, { taluk: s.taluk }, { route: false });
  return { kpi: d.kpi, map: d.map, snapshot: d.snapshot, severity: d.severity, news: d.news, bell: d.bell, collection: d.collection,
    severityMix: d.severityMix, byCategory: d.bottom.byDept };
}

/** Cheap check the console polls: new grievances, Collector decisions, a new pipeline build. */
export async function officerPulse(dept: DeptProfile) {
  const now = await asOf();
  const b = withStage(dept.code, now);
  const win = windowWhere(now, { period: "quarterly", zone: null, taluk: null });
  const [[c], meta, fb] = await Promise.all([
    q(`${b.sql} SELECT SUM(stage = 'new') AS new FROM w WHERE ${win.sql}`, [...b.params, ...win.params]),
    exportMeta(),
    collectorFeedback(dept.code, { period: "quarterly", zone: null, taluk: null }, 1)
  ]);
  const updated = refreshInfo(meta.exported_at ?? null, []);
  return { now, exportedAt: meta.exported_at ?? null, newCount: Number(c?.new ?? 0), lastDecision: fb[0]?.at ?? null, updatedAt: updated.at };
}

/** Current IST wall-clock time, "YYYY-MM-DD HH:MM:SS" (decisions carry real times, not the pipeline's as-of). */
const istNow = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");

/** The Collector's verify / return decisions on this department's grievances, made in the period. */
async function collectorFeedback(dept: string, s: Scope, limit: number) {
  const r = await q(
    `SELECT d.decision_id AS did, d.incident_id AS id, d.decision, d.note, ${fmt("d.decided_at")} AS at,
            i.title, i.category_label AS type, i.place_text AS loc, i.zone_name
     FROM ${ops("collector_decisions")} d JOIN incidents i ON i.incident_id = d.incident_id
     WHERE i.lead_dept = ? AND d.decision IN ('verify', 'resolve', 'reopen') AND d.decided_at >= ?
       ${s.zone ? "AND i.zone_no = ?" : ""} ${s.taluk ? "AND i.taluk_code = ?" : ""}
     ORDER BY d.decided_at DESC, d.decision_id DESC LIMIT ${Math.max(1, Math.min(50, limit))}`,
    [dept, periodSince(s.period, istNow()), ...(s.zone ? [s.zone] : []), ...(s.taluk ? [s.taluk] : [])]
  );
  return r.map((x) => ({ ...x, ok: x.decision !== "reopen" })) as Row[];
}

/** Publishers of the articles linked to each incident (and their news stories). */
async function outletsFor(ids: string[]): Promise<Record<string, string[]>> {
  if (!ids.length) return {};
  const r = await q(
    `SELECT d1.linked_incident_id AS id, GROUP_CONCAT(DISTINCT d2.publisher ORDER BY d2.publisher SEPARATOR '|') AS p
     FROM documents d1 JOIN documents d2 ON d2.story_id = d1.story_id OR d2.doc_id = d1.doc_id
     WHERE d1.linked_incident_id IN (?) AND d2.publisher IS NOT NULL GROUP BY d1.linked_incident_id`,
    [ids]
  );
  return Object.fromEntries(r.map((x) => [x.id, String(x.p).split("|").filter(Boolean)]));
}

// ---------------------------------------------------------------- list --

export interface ListFilter extends Scope {
  tab: Tab | "all";
  page: number;
  per: number;
  cat: string | null;
  q: string | null;
  /** the Collector's snapshot tiles: severe or high and open; open and past deadline; open and due within 24 hours */
  flag?: ListFlagKey | null;
  /** one severity level (Severe, High, Medium, Low) */
  sev?: string | null;
}

export async function grievanceList(dept: DeptProfile, f: ListFilter) {
  const now = await asOf();
  const b = withStage(dept.code, now);
  const win = windowWhere(now, f);
  const stages = f.tab === "all" ? [...TAB_STAGES.new, ...TAB_STAGES.action, ...TAB_STAGES.sent, ...TAB_STAGES.verified] : TAB_STAGES[f.tab];
  const where = [win.sql, `w.stage IN (?)`];
  const params: unknown[] = [...b.params, ...win.params, stages];
  if (f.cat) (where.push("w.category_code = ?"), params.push(f.cat));
  if (f.sev) (where.push("w.severity_level = ?"), params.push(f.sev));
  if (f.flag === "due") (where.push(DUE_SQL), params.push(now, now));
  else if (f.flag) where.push(FLAG_SQL[f.flag]);
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    where.push("(w.title LIKE ? OR w.place_text LIKE ? OR w.incident_id LIKE ? OR w.category_label LIKE ? OR w.zone_name LIKE ?)");
    params.push(like, like, like, like, like);
  }
  const order = f.tab === "new" || f.tab === "action" ? `${SEV_ORDER}, w.citizen_complaints DESC, w.first_reported_at DESC, w.incident_id`
    : f.tab === "all" ? "w.first_reported_at DESC" : "w.upd DESC, w.incident_id";
  const W = where.join(" AND ");
  const per = Math.max(1, Math.min(100, f.per));
  const [rows, [tot]] = await Promise.all([
    q(`${b.sql} SELECT ${ROW} FROM w WHERE ${W} ORDER BY ${order} LIMIT ${per} OFFSET ${Math.max(0, f.page) * per}`, params),
    q(`${b.sql} SELECT COUNT(*) AS n FROM w WHERE ${W}`, params)
  ]);
  return { now, rows: rows.map(tidy), total: Number(tot?.n ?? 0), page: f.page, per };
}

/** Search every grievance of the last 90 days, whatever the filters. */
export async function search(dept: DeptProfile, text: string) {
  const r = await grievanceList(dept, { tab: "all", period: "quarterly", zone: null, taluk: null, page: 0, per: 8, cat: null, q: text });
  return r.rows;
}

// -------------------------------------------------------------- detail --

const SOURCE_LABEL: Record<string, string> = {
  grievance: "Citizen complaint", police: "Police report", pwd: "PWD field record", hospital: "Hospital report", news: "News report", imd: "IMD warning"
};
const CHANNEL_LABEL: Record<string, string> = {
  citizen_app: "Citizen app", citizen_grievance: "Grievance portal", control_room_112: "Control room 112", fir_walk_in: "Police station",
  patrol: "Police patrol", field_staff: "Field staff", collector_office: "Collector's office", hospital_mis: "Hospital MIS",
  control_room: "Control room", media: "News"
};

async function stageRow(dept: string, id: string, now: string, conn?: PoolConnection) {
  const b = withStage(dept, now);
  const [r] = await q(
    `${b.sql} SELECT ${ROW}, w.summary, w.media_only, ${fmt("w.sla_due_at")} AS due, ${fmt("w.closed_at")} AS closed_at
     FROM w WHERE w.incident_id = ?`,
    [...b.params, id], conn
  );
  return r ? tidy(r) : null;
}

/** One grievance of the department: facts, workflow, completion reports, timeline and sources. Null if not this department's. */
export async function grievanceDetail(dept: DeptProfile, id: string) {
  const now = await asOf();
  const g = await stageRow(dept.code, id, now);
  if (!g) return null;
  const [pipeline, steps, decisions, members, docs, reports] = await Promise.all([
    q(`SELECT ${fmt("at")} AS t, step, note, actor FROM incident_timeline WHERE incident_id = ? ORDER BY at`, [id]),
    q(`SELECT step, note, actor, ${fmt("at")} AS t FROM ${ops("officer_steps")} WHERE incident_id = ? AND dept_code = ? ORDER BY at, step_id`, [id, dept.code]),
    q(`SELECT decision, note, decided_by, ${fmt("decided_at")} AS t FROM ${ops("collector_decisions")} WHERE incident_id = ? ORDER BY decided_at, decision_id`, [id]),
    q(`SELECT m.source, m.channel, ${fmt("m.reported_at")} AS t, m.title, m.role, LEFT(e.text, 280) AS text
       FROM incident_members m LEFT JOIN events e ON e.event_id = m.event_id WHERE m.incident_id = ? ORDER BY m.reported_at LIMIT 60`, [id]),
    q(`SELECT publisher, title, url, ${fmt("published_at")} AS t FROM documents WHERE linked_incident_id = ?
          OR story_id IN (SELECT story_id FROM (SELECT story_id FROM documents WHERE linked_incident_id = ? AND story_id IS NOT NULL) s)
       ORDER BY published_at LIMIT 30`, [id, id]),
    q(`SELECT report_id AS rid, remarks, photo_dir, photos, sent_by, ${fmt("sent_at")} AS t
       FROM ${ops("officer_reports")} WHERE incident_id = ? AND dept_code = ? ORDER BY sent_at DESC, report_id DESC`, [id, dept.code])
  ]);

  const kindOf = (step: string) => (/resolved|verified/i.test(step) ? "fin" : /reject|lapsed|return|escalat/i.test(step) ? "esc" : "");
  const timeline = [
    ...pipeline.map((p) => ({ t: p.t, label: p.step, note: p.note ?? (p.actor ? `By ${p.actor}` : ""), kind: kindOf(p.step) })),
    ...steps.map((st) => ({
      t: st.t,
      label: st.step === "approve" ? "Approved by department" : st.step === "action" ? "Work started" : "Sent to Collector",
      note: st.step === "approve" ? `Approved by ${st.actor}; assigned to ${g.officer ?? "the field officer"}`
        : st.step === "action" ? `${g.officer ?? "Field team"} started work on site` : st.note ? `Completion report: “${String(st.note).slice(0, 140)}”` : "Completion report sent",
      kind: ""
    })),
    ...decisions.filter((d) => d.decision !== "note").map((d) => ({
      t: d.t,
      label: ({ verify: "Verified by Collector", reopen: "Returned by Collector", resolve: "Resolved by Collector", reject: "Rejected by Collector", escalate: "Escalated by Collector" } as Record<string, string>)[d.decision] ?? d.decision,
      note: d.note ?? (d.decision === "verify" ? "Work verified; grievance closed" : ""),
      kind: d.decision === "reopen" || d.decision === "reject" || d.decision === "escalate" ? "esc" : "fin"
    }))
  ].sort((a, b2) => String(a.t).localeCompare(String(b2.t)));

  const lastVerify = [...decisions].reverse().find((d) => d.decision === "verify" || d.decision === "resolve");
  const lastReturn = [...decisions].reverse().find((d) => d.decision === "reopen");
  return {
    now,
    grievance: g,
    next: NEXT_STEP[g.stage as Stage] ?? null,
    timeline,
    sources: [
      ...members.map((m) => ({
        kind: m.source as string, label: SOURCE_LABEL[m.source] ?? m.source, name: m.source === "news" ? null : CHANNEL_LABEL[m.channel] ?? m.channel,
        t: m.t, note: m.source === "news" ? m.title : (m.text || m.title), first: m.role === "first_report", url: null as string | null
      })),
      ...docs.map((d) => ({ kind: "news", label: "News report", name: d.publisher, t: d.t, note: d.title, first: false, url: d.url as string | null }))
    ].sort((a, b2) => String(a.t).localeCompare(String(b2.t))),
    reports: reports.map((r) => {
      const names: string[] = Array.isArray(r.photos) ? r.photos : JSON.parse(String(r.photos || "[]"));
      return {
        id: Number(r.rid), remarks: String(r.remarks), by: String(r.sent_by), t: String(r.t),
        photos: names.map((nm) => photoUrl(r.photo_dir, nm)),
        verifiedAt: lastVerify && lastVerify.t >= r.t ? String(lastVerify.t) : null,
        returned: lastReturn && lastReturn.t >= r.t ? { t: String(lastReturn.t), note: String(lastReturn.note ?? "") } : null
      };
    }),
    firstSource: members[0] ? SOURCE_LABEL[members[0].source] ?? members[0].source : docs[0]?.publisher ?? "—"
  };
}
export type GrievanceDetail = NonNullable<Awaited<ReturnType<typeof grievanceDetail>>>;

// ------------------------------------------------------------ workflow --

export class WorkflowError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Stages each step starts from: approve a new grievance; send one that is in action (approved or started). */
const ALLOWED: Record<"approve" | "send", Stage[]> = { approve: ["new"], send: ["approved", "action"] };

/**
 * Records one workflow step after checking, under a per-grievance lock, that the
 * grievance belongs to the department and is at a stage the step starts from.
 * `send` also stores the completion report (photos are written by the caller first).
 */
export async function recordStep(
  dept: DeptProfile, id: string, step: "approve" | "send", actor: { email: string; userId: number },
  report?: { remarks: string; photoDir: string; photos: string[] }
): Promise<{ stage: Stage; reportId: number | null }> {
  const now = await asOf();
  const conn = await intelPool.getConnection();
  const lock = `officer:${id}`;
  let locked = false;
  try {
    const [[l]] = await conn.query<RowDataPacket[]>(`SELECT GET_LOCK(?, 5) AS ok`, [lock]);
    locked = Number(l?.ok) === 1;
    if (!locked) throw new WorkflowError(409, "Someone else is updating this grievance. Try again in a moment.");
    const g = await stageRow(dept.code, id, now, conn);
    if (!g) throw new WorkflowError(404, "Grievance not found in your department.");
    if (!ALLOWED[step].includes(g.stage as Stage)) {
      throw new WorkflowError(409, `This grievance is already at “${STAGE_LABEL[g.stage as Stage] ?? g.stage}”. Refresh to see its latest stage.`);
    }
    await conn.beginTransaction();
    let reportId: number | null = null;
    if (step === "send" && report) {
      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO ${ops("officer_reports")} (incident_id, dept_code, remarks, photo_dir, photos, sent_by, sent_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, dept.code, report.remarks, report.photoDir, JSON.stringify(report.photos), actor.email, actor.userId]
      );
      reportId = res.insertId;
    }
    const note = step === "send" ? report?.remarks ?? null : null;
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO ${ops("officer_steps")} (incident_id, dept_code, step, note, report_id, actor, actor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, dept.code, step, note, reportId, actor.email, actor.userId]
    );
    await conn.query(
      `INSERT INTO ${ops("audit_log")} (actor, action, table_name, record_id, before_value, after_value) VALUES (?, ?, 'officer_steps', ?, ?, ?)`,
      [actor.email, `officer:${step}`, id, JSON.stringify({ stage: g.stage, status_std: g.status, dept: dept.code }),
        JSON.stringify({ step_id: res.insertId, step, report_id: reportId, photos: report?.photos.length ?? 0 })]
    );
    await conn.commit();
    return { stage: step === "approve" ? "approved" : "sent", reportId };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    if (locked) await conn.query(`SELECT RELEASE_LOCK(?)`, [lock]).catch(() => undefined);
    conn.release();
  }
}

/** Department that sent a report's photos, for the photo route's access check. */
export async function photoOwner(photoDir: string): Promise<string | null> {
  const [r] = await q(`SELECT dept_code FROM ${ops("officer_reports")} WHERE photo_dir = ?`, [photoDir]);
  return r ? String(r.dept_code) : null;
}
