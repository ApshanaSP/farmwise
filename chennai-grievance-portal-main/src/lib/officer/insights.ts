/**
 * Department insights for the officer console (and the Collector viewing it), built only from
 * the district intelligence store that the pipeline's daily collection loads: `district_intel`
 * (incidents, events, observations, pwd_works, hotspots) and the market prices in
 * `district_intel_ops`. Nothing here fetches or generates data, and nothing is estimated:
 * every figure is a count, sum or average of stored records.
 *
 * Each department gets the modules whose data concerns it (police records for the Police,
 * the hospital MIS for Government Hospitals, lakes and works for PWD, rain and IMD warnings for
 * the departments whose work rain drives, ...), then what its grievances are about (complaint
 * patterns) and its own work record from the grievance store. A source's window ends at its newest record, so a feed that
 * was not collected today still shows its last real data, marked as old.
 */
import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { PERIODS, asOf, periodSince, periodWindow, type Period } from "@/lib/collector/intel";

type Row = Record<string, any>;
async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await intelPool.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}

export interface InsightKpi { label: string; value: string; sub?: string; tone?: "sev" | "high" | "med" | "low" | "info" | "violet" }
export interface InsightChart { kind: "line" | "bar" | "hbar"; title: string; labels: string[]; values: number[]; unit: string }
export interface InsightTable { title: string; columns: string[]; rows: (string | number)[][] }
export interface InsightModule {
  key: string;
  title: string;
  source: string;
  /** newest record in the source */
  asOf: string | null;
  /** the source has nothing newer than two days before the store's as-of time */
  stale: boolean;
  /** why the data may be old, if it is */
  refreshNote: string | null;
  /** "filtered": follows the zone / taluk filter; "district": the source covers the whole district */
  area: "filtered" | "district";
  window: string;
  kpis: InsightKpi[];
  charts: InsightChart[];
  tables: InsightTable[];
  /** short briefing sentences, each a plain statement of the figures above */
  notes: string[];
  empty?: string;
}
export interface InsightScope { period: Period; zone: number | null; taluk: string | null }

/** Which store data concerns each department, most useful first. Every department also gets "patterns" and "work". */
const MODULES: Record<string, string[]> = {
  // rain drives drains, roads, streetlights, garbage, fallen trees and flooded subways
  "GCC-ENG": ["weather"],
  "GCC-ELE": ["weather"],
  "GCC-SWM": ["weather", "air"],
  "GCC-PRK": ["weather"],
  "GCC-BRG": ["weather", "lakes"],
  "TANGEDCO": ["weather"],
  "POL-GCP": ["police"],
  "HLT-DMS": ["hospital"],
  "GCC-HLT": ["hospital", "air"],
  "GCC-FWD": ["hospital"],
  "PWD-WRD": ["lakes", "weather", "pwdworks", "pwdfield"],
  "PWD-BLD": ["pwdworks", "pwdfield"],
  "GCC-SWD": ["weather", "lakes"],
  "DIST-DM": ["weather", "lakes"],
  "CMWSSB": ["lakes"],
  "TNPCB": ["air"],
  "DIST-REV": ["markets"]
};
/** Source labels, and the pipeline feed each module reads (for the freshness check). */
const SOURCE: Record<string, { label: string; feed: string | null }> = {
  work: { label: "Grievance store (all sources, deduplicated)", feed: "grievance" },
  patterns: { label: "Grievance store (all sources, deduplicated)", feed: "grievance" },
  police: { label: "Greater Chennai Police records", feed: "police" },
  hospital: { label: "Government hospitals (hospital MIS)", feed: "hospital" },
  lakes: { label: "PWD lake levels", feed: "pwd" },
  pwdworks: { label: "PWD works register", feed: "pwd" },
  pwdfield: { label: "PWD field records", feed: "pwd" },
  weather: { label: "IMD and CFM-DSS", feed: "imd" },
  air: { label: "CPCB / TNPCB stations", feed: "cpcb" },
  markets: { label: "AGMARKNET (Chennai Uzhavar Sandhais)", feed: null }
};

const STALE_HOURS = 48;
const n = (v: number) => Math.round(v).toLocaleString("en-IN");
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-IN");
const pct = (v: number) => `${Math.round(v)}%`;
const day = (s: string) => new Date(`${String(s).slice(0, 10)}T12:00:00+05:30`).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const hoursBetween = (a: string, b: string) => (Date.parse(b.replace(" ", "T") + "+05:30") - Date.parse(a.replace(" ", "T") + "+05:30")) / 3_600_000;
const addDays = (d: string, k: number) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
const LABEL = (s: string) => String(s ?? "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const fmt = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:%s')`;
const PERIOD_DAYS: Record<Period, number> = { daily: 1, weekly: 7, monthly: 30, quarterly: 90 };

/** Area filter on tables that carry zone_no / taluk_code. */
function areaSql(s: InsightScope, alias = "") {
  const a = alias ? `${alias}.` : "";
  return {
    sql: `${s.zone ? ` AND ${a}zone_no = ?` : ""}${s.taluk ? ` AND ${a}taluk_code = ?` : ""}`,
    params: [...(s.zone ? [s.zone] : []), ...(s.taluk ? [s.taluk] : [])] as unknown[]
  };
}
function windowText(period: Period, end: string | null) {
  if (!end) return "No records";
  return period === "daily" ? `Latest day of data (${day(end)})` : `${PERIODS[period].label.replace("Last", "The last")} of data, to ${day(end)}`;
}

export async function deptInsights(dept: string, s: InsightScope): Promise<InsightModule[]> {
  const now = await asOf();
  const keys = [...(MODULES[dept] ?? []), "patterns", "work"];
  const out: InsightModule[] = [];
  for (const key of keys) {
    const b = await BUILDERS[key](dept, s, now);
    const newest = b.newest ?? null;
    const stale = !newest || hoursBetween(newest, now) > STALE_HOURS;
    out.push({
      key, source: SOURCE[key].label, asOf: newest, stale,
      refreshNote: stale && newest ? `the newest ${SOURCE[key].feed ?? "record"} data in the store is from ${day(newest)}` : null,
      title: b.title, area: b.area, window: b.window, kpis: b.kpis, charts: b.charts, tables: b.tables, notes: b.notes, ...(b.empty ? { empty: b.empty } : {})
    });
  }
  return out;
}

type Built = Omit<InsightModule, "key" | "source" | "asOf" | "stale" | "refreshNote"> & { newest: string | null };
const none = (head: Pick<Built, "title" | "area" | "window">, empty: string, newest: string | null = null): Built =>
  ({ ...head, kpis: [], charts: [], tables: [], notes: [], empty, newest });

const BUILDERS: Record<string, (dept: string, s: InsightScope, now: string) => Promise<Built>> = {
  work, patterns, police, hospital, lakes, pwdworks, pwdfield, weather, air, markets
};

// -------------------------------------------------------- complaint patterns --

/** What the department's grievances are about: types rising or falling on the previous period, wards that keep reporting, where reports come from. */
async function patterns(dept: string, s: InsightScope, now: string): Promise<Built> {
  const head = { title: "Complaint patterns", area: "filtered" as const, window: windowText(s.period, now) };
  const a = areaSql(s, "i");
  const w = periodWindow(s.period, now, "i.first_reported_at");
  const pv = periodWindow(s.period, now, "i.first_reported_at", 1);
  const [types, wards, [src]] = await Promise.all([
    q(`SELECT i.category_label AS l, SUM(${w.sql}) AS cur, SUM(${pv.sql}) AS prev FROM incidents i
       WHERE i.lead_dept = ? AND ((${w.sql}) OR (${pv.sql}))${a.sql} GROUP BY i.category_label ORDER BY cur DESC, prev DESC LIMIT 12`,
      [...w.params, ...pv.params, dept, ...w.params, ...pv.params, ...a.params]),
    q(`SELECT i.ward_no AS ward, MAX(i.zone_name) AS zone, COUNT(*) AS n, SUM(i.is_open) AS open FROM incidents i
       WHERE i.lead_dept = ? AND ${w.sql}${a.sql} AND i.ward_no IS NOT NULL GROUP BY i.ward_no ORDER BY n DESC, open DESC LIMIT 8`,
      [dept, ...w.params, ...a.params]),
    q(`SELECT COUNT(*) AS n, SUM(i.citizen_complaints > 0) AS portal, SUM(i.outlet_count > 0) AS news, SUM(i.sources LIKE '%police%') AS police,
              SUM(i.citizen_complaints) AS complaints
       FROM incidents i WHERE i.lead_dept = ? AND ${w.sql}${a.sql}`, [dept, ...w.params, ...a.params])
  ]);
  const total = Number(src?.n ?? 0);
  if (!total) return none(head, "No grievances for this department in this period and area.", now);
  const rows = types.map((r) => ({ l: String(r.l ?? "Other"), cur: Number(r.cur ?? 0), prev: Number(r.prev ?? 0) }))
    .map((r) => ({ ...r, ch: r.prev ? ((r.cur - r.prev) / r.prev) * 100 : null }));
  // a real rise: at least 3 this period and a quarter more than before (or new this period)
  const rising = rows.filter((r) => r.cur >= 3 && (r.ch == null ? r.prev === 0 : r.ch >= 25)).sort((x, y) => (y.cur - y.prev) - (x.cur - x.prev));
  const falling = rows.filter((r) => r.prev >= 3 && r.ch != null && r.ch <= -25).sort((x, y) => (x.cur - x.prev) - (y.cur - y.prev));
  const top = wards[0];
  const news = Number(src?.news ?? 0);
  const chg = (r: { ch: number | null; prev: number }) => (r.ch == null ? (r.prev ? "-" : "new") : `${r.ch >= 0 ? "+" : "−"}${pct(Math.abs(r.ch))}`);
  return {
    ...head, newest: now,
    kpis: [
      { label: "Grievances", value: n(total), sub: `${n(Number(src?.complaints ?? 0))} citizen complaints behind them`, tone: "info" },
      { label: "Types rising", value: n(rising.length), sub: rising[0] ? `most: ${rising[0].l} (${chg(rising[0])})` : "none rising", tone: rising.length ? "high" : "low" },
      { label: "Busiest ward", value: top ? `Ward ${top.ward}` : "—", sub: top ? `${top.zone ?? ""} · ${plural(Number(top.n), "grievance")}, ${n(Number(top.open ?? 0))} open` : "no ward recorded", tone: "violet" },
      { label: "Reported in the news", value: n(news), sub: `${pct((news / total) * 100)} of grievances`, tone: news ? "sev" : "low" }
    ],
    charts: [{ kind: "hbar", title: "Wards with the most grievances", labels: wards.map((r) => `Ward ${r.ward}${r.zone ? ` · ${r.zone}` : ""}`), values: wards.map((r) => Number(r.n)), unit: "grievances" }],
    tables: [{
      title: `By type, against the ${PERIODS[s.period].prev}`,
      columns: ["Type", "This period", "Before", "Change"],
      rows: rows.map((r) => [r.l, n(r.cur), n(r.prev), chg(r)])
    }],
    notes: [
      rising.length ? `${rising.slice(0, 3).map((r) => `${r.l} (${n(r.cur)}, ${chg(r)})`).join(", ")} ${rising.length === 1 ? "is" : "are"} rising on the ${PERIODS[s.period].prev}.` : `No complaint type is rising on the ${PERIODS[s.period].prev}.`,
      top ? `Ward ${top.ward}${top.zone ? ` (${top.zone})` : ""} reported the most (${plural(Number(top.n), "grievance")}, ${n(Number(top.open ?? 0))} still open)${wards[1] ? `, then Ward ${wards[1].ward} (${n(Number(wards[1].n))})` : ""}.` : null,
      falling[0] ? `${falling[0].l} fell to ${n(falling[0].cur)} from ${n(falling[0].prev)}.` : null,
      news ? `${plural(news, "grievance")} also reached the news; these are the ones the public sees.` : null
    ].filter(Boolean) as string[]
  };
}

// ------------------------------------------------------------ work record --

/** The department's own record in the grievance store: how fast it closes work, what it misses, where it repeats. */
async function work(dept: string, s: InsightScope, now: string): Promise<Built> {
  const head = { title: "Work record", area: "filtered" as const, window: windowText(s.period, now) };
  const a = areaSql(s, "i");
  const w = periodWindow(s.period, now, "i.first_reported_at");
  const prev = periodWindow(s.period, now, "i.first_reported_at", 1);
  const W = `i.lead_dept = ? AND ${w.sql}${a.sql}`, P = [dept, ...w.params, ...a.params];
  const since = periodSince(s.period, now);
  const [[k], [kp], byType, byZone, repeats, [dec]] = await Promise.all([
    q(`SELECT COUNT(*) AS n, SUM(i.is_open = 0) AS closed, SUM(i.is_open = 1 AND i.sla_breached = 1) AS overdue,
              SUM(i.is_open = 1) AS open, SUM(i.severity_level IN ('Severe', 'High')) AS serious,
              AVG(CASE WHEN i.is_open = 0 AND i.closed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, i.first_reported_at, i.closed_at) / 60 END) AS hrs,
              AVG(i.hours_to_first_action) AS first_h, SUM(i.citizen_complaints) AS complaints,
              SUM(i.is_open = 0 AND COALESCE(i.sla_breached, 0) = 0) AS on_time
       FROM incidents i WHERE ${W}`, P),
    q(`SELECT COUNT(*) AS n FROM incidents i WHERE i.lead_dept = ? AND ${prev.sql}${a.sql}`, [dept, ...prev.params, ...a.params]),
    q(`SELECT i.category_label AS l, COUNT(*) AS n,
              AVG(CASE WHEN i.is_open = 0 AND i.closed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, i.first_reported_at, i.closed_at) / 1440 END) AS days
       FROM incidents i WHERE ${W} GROUP BY i.category_label ORDER BY n DESC LIMIT 8`, P),
    q(`SELECT i.zone_name AS l, SUM(i.is_open = 1 AND i.sla_breached = 1) AS v FROM incidents i WHERE ${W} AND i.zone_name IS NOT NULL
       GROUP BY i.zone_name HAVING v > 0 ORDER BY v DESC LIMIT 8`, P),
    // places that keep coming back: the pipeline's hotspots, with this department's incidents in the window
    q(`SELECT h.top_place AS place, i.category_label AS type, COUNT(*) AS n, SUM(i.is_open) AS open, h.incidents AS total
       FROM incidents i JOIN hotspots h ON h.hotspot_id = i.hotspot_id WHERE ${W}
       GROUP BY h.hotspot_id, h.top_place, i.category_label, h.incidents ORDER BY n DESC, total DESC LIMIT 8`, P),
    q(`SELECT SUM(d.decision IN ('verify', 'resolve')) AS verified, SUM(d.decision = 'reopen') AS returned
       FROM ${ops("collector_decisions")} d JOIN incidents i ON i.incident_id = d.incident_id
       WHERE i.lead_dept = ? AND d.decided_at >= ?${a.sql}`, [dept, since, ...a.params])
  ]);
  const total = Number(k?.n ?? 0);
  if (!total) return none(head, "No grievances for this department in this period and area.", now);
  const closed = Number(k.closed ?? 0), onTime = Number(k.on_time ?? 0);
  const prevN = Number(kp?.n ?? 0);
  const change = prevN ? ((total - prevN) / prevN) * 100 : null;
  const hrs = k.hrs == null ? null : Number(k.hrs);
  const took = (h: number) => (h >= 48 ? `${n1(h / 24)} days` : `${n1(h)} hours`);
  const slow = byType.filter((r) => r.days != null).sort((x, y) => Number(y.days) - Number(x.days))[0];
  return {
    ...head, newest: now,
    kpis: [
      { label: "Grievances", value: n(total), sub: change == null ? `${n(Number(k.complaints ?? 0))} citizen complaints` : `${change >= 0 ? "+" : "−"}${pct(Math.abs(change))} vs. ${PERIODS[s.period].prev}`, tone: "info" },
      { label: "Closed", value: pct((closed / total) * 100), sub: `${n(closed)} of ${n(total)}${hrs != null ? ` · ${took(hrs)} on average` : ""}`, tone: closed / total >= 0.7 ? "low" : "med" },
      { label: "Closed on time", value: closed ? pct((onTime / closed) * 100) : "—", sub: "within the deadline", tone: closed && onTime / closed < 0.7 ? "high" : "low" },
      { label: "Open past deadline", value: n(Number(k.overdue ?? 0)), sub: `of ${n(Number(k.open ?? 0))} still open`, tone: Number(k.overdue) ? "sev" : "low" },
      { label: "Collector's checks", value: n(Number(dec?.verified ?? 0) + Number(dec?.returned ?? 0)), sub: `${n(Number(dec?.verified ?? 0))} verified · ${n(Number(dec?.returned ?? 0))} returned`, tone: Number(dec?.returned) ? "high" : "violet" }
    ],
    charts: [
      { kind: "hbar", title: "Average days to close, by type", labels: byType.filter((r) => r.days != null).map((r) => r.l), values: byType.filter((r) => r.days != null).map((r) => Math.round(Number(r.days) * 10) / 10), unit: "days" },
      { kind: "hbar", title: "Open past deadline, by zone", labels: byZone.map((r) => r.l), values: byZone.map((r) => Number(r.v)), unit: "grievances" }
    ],
    tables: [{
      title: "Places that keep coming back",
      columns: ["Place", "Type", "In this period", "Still open", "In 90 days"],
      rows: repeats.map((r) => [r.place ?? "—", r.type ?? "—", n(Number(r.n)), n(Number(r.open ?? 0)), n(Number(r.total ?? 0))])
    }],
    notes: [
      `${plural(total, "grievance")} ${change == null ? "were reported" : `were reported, ${change >= 0 ? "up" : "down"} ${pct(Math.abs(change))} on the ${PERIODS[s.period].prev}`}; ${pct((closed / total) * 100)} are closed${hrs != null ? `, in ${took(hrs)} on average` : ""}.`,
      closed ? `${pct((onTime / closed) * 100)} of the closed ones met their deadline.` : null,
      Number(k.overdue) ? `${plural(Number(k.overdue), "open grievance")} ${Number(k.overdue) === 1 ? "is" : "are"} past the deadline${byZone[0] ? `, most in ${byZone[0].l} (${n(Number(byZone[0].v))})` : ""}.` : "No open grievance is past its deadline.",
      slow ? `${slow.l} takes the longest to close (${n1(Number(slow.days))} days on average).` : null,
      k.first_h != null ? `First action came ${took(Number(k.first_h))} after the report, on average.` : null,
      repeats[0] ? `${repeats[0].place} keeps coming back (${plural(Number(repeats[0].n), "grievance")} of ${String(repeats[0].type).toLowerCase()} in this period).` : null
    ].filter(Boolean) as string[]
  };
}

// ----------------------------------------------------------------- police --

const CHANNEL: Record<string, string> = {
  control_room_112: "Control room 112", fir_walk_in: "Walk-in FIR", patrol: "Patrol", media: "News", citizen_grievance: "Grievance portal"
};

async function police(_dept: string, s: InsightScope): Promise<Built> {
  const [[m]] = await Promise.all([q(`SELECT ${fmt("MAX(reported_at)")} AS t FROM events WHERE source = 'police'`)]);
  const newest = (m?.t as string | null) ?? null;
  const head = { title: "Police records", area: "filtered" as const, window: windowText(s.period, newest) };
  if (!newest) return none(head, "No police records are in the store.");
  const a = areaSql(s, "e");
  const w = periodWindow(s.period, newest, "e.reported_at");
  const W = `e.source = 'police' AND ${w.sql}${a.sql}`, P = [...w.params, ...a.params];
  const [[k], byCat, byHour, byChannel, byZone] = await Promise.all([
    q(`SELECT COUNT(*) AS n, SUM(e.category_code = 'CRIME_VIOLENT') AS violent, SUM(e.category_code = 'CRIME_PROPERTY') AS property,
              SUM(e.category_code = 'ROAD_ACCIDENT') AS accidents, SUM(COALESCE(e.dead, 0)) AS dead, SUM(COALESCE(e.injured, 0)) AS injured,
              SUM(e.status_std <> 'Resolved') AS open, AVG(CASE WHEN e.response_applicable = 1 THEN e.response_minutes END) AS resp,
              SUM(e.category_code = 'MISSING_PERSON') AS missing
       FROM events e WHERE ${W}`, P),
    q(`SELECT COALESCE(c.label, e.category_code) AS l, COUNT(*) AS v FROM events e LEFT JOIN ref_categories c ON c.category_code = e.category_code
       WHERE ${W} GROUP BY l ORDER BY v DESC LIMIT 10`, P),
    q(`SELECT HOUR(COALESCE(e.occurred_at, e.reported_at)) AS h, COUNT(*) AS v FROM events e WHERE ${W} GROUP BY h ORDER BY h`, P),
    q(`SELECT e.channel AS c, COUNT(*) AS v FROM events e WHERE ${W} GROUP BY e.channel ORDER BY v DESC`, P),
    q(`SELECT COALESCE(e.zone_no, 0) AS z, MAX(z.zone_name) AS l, COUNT(*) AS v, SUM(e.category_code = 'CRIME_VIOLENT') AS violent,
              SUM(e.category_code = 'ROAD_ACCIDENT') AS acc, SUM(COALESCE(e.dead, 0)) AS dead
       FROM events e LEFT JOIN (SELECT DISTINCT zone_no, zone_name FROM ref_wards) z ON z.zone_no = e.zone_no
       WHERE ${W} GROUP BY z ORDER BY v DESC LIMIT 8`, P)
  ]);
  const total = Number(k?.n ?? 0);
  if (!total) return none(head, "No police records in this period and area.", newest);
  const hours = Array.from({ length: 24 }, (_, h) => Number(byHour.find((r) => Number(r.h) === h)?.v ?? 0));
  const peak = hours.indexOf(Math.max(...hours));
  const hh = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
  return {
    ...head, newest,
    kpis: [
      { label: "Cases recorded", value: n(total), sub: `${n(Number(k.open ?? 0))} still under investigation`, tone: "info" },
      { label: "Violent crime", value: n(Number(k.violent ?? 0)), sub: `${n(Number(k.property ?? 0))} property crimes`, tone: Number(k.violent) ? "sev" : "low" },
      { label: "Road accidents", value: n(Number(k.accidents ?? 0)), sub: `${n(Number(k.dead ?? 0))} deaths · ${n(Number(k.injured ?? 0))} injured`, tone: Number(k.dead) ? "sev" : "high" },
      { label: "Response time", value: k.resp == null ? "—" : `${n(Number(k.resp))} min`, sub: "average, where a response applies", tone: "violet" }
    ],
    charts: [
      { kind: "hbar", title: "Cases by type", labels: byCat.map((r) => r.l), values: byCat.map((r) => Number(r.v)), unit: "cases" },
      { kind: "bar", title: "Cases by hour of the day", labels: hours.map((_, h) => hh(h)), values: hours, unit: "cases" },
      { kind: "hbar", title: "How cases reach the police", labels: byChannel.map((r) => CHANNEL[r.c] ?? LABEL(r.c ?? "Other")), values: byChannel.map((r) => Number(r.v)), unit: "cases" }
    ],
    tables: [{
      title: "Zones with the most cases",
      columns: ["Zone", "Cases", "Violent", "Road accidents", "Deaths"],
      rows: byZone.map((r) => [r.l ?? "Outside GCC zones", n(Number(r.v)), n(Number(r.violent ?? 0)), n(Number(r.acc ?? 0)), n(Number(r.dead ?? 0))])
    }],
    notes: [
      `${plural(total, "case")} were recorded; the most common was ${String(byCat[0]?.l ?? "—").toLowerCase()} (${n(Number(byCat[0]?.v ?? 0))}).`,
      Number(k.accidents) ? `${plural(Number(k.accidents), "road accident")} killed ${n(Number(k.dead ?? 0))} and injured ${n(Number(k.injured ?? 0))}.` : null,
      hours[peak] ? `Most cases happen around ${hh(peak)} (${n(hours[peak])}); patrols matter most then.` : null,
      byZone[0]?.l ? `${byZone[0].l} zone recorded the most cases (${n(Number(byZone[0].v))}).` : null,
      Number(k.missing) ? `${plural(Number(k.missing), "missing-person report")} were filed.` : null
    ].filter(Boolean) as string[]
  };
}

// --------------------------------------------------------------- hospitals --

async function hospital(_dept: string, s: InsightScope): Promise<Built> {
  const a = areaSql(s);
  const [last] = await q(`SELECT DATE_FORMAT(MAX(observed_at), '%Y-%m-%d') AS d FROM observations WHERE source = 'hospital'${a.sql}`, a.params);
  const head = { title: "Government hospitals", area: "filtered" as const, window: windowText(s.period, last?.d ?? null) };
  if (!last?.d) return none(head, "No government hospital in this area reports to the hospital MIS.");
  const end = last.d as string, start = addDays(end, 1 - PERIOD_DAYS[s.period]);
  const W = `source = 'hospital' AND observed_at >= ? AND observed_at < ? + INTERVAL 1 DAY${a.sql}`, P = [start, end, ...a.params];
  const [daily, latest, diseases, alerts] = await Promise.all([
    q(`SELECT DATE_FORMAT(observed_at, '%Y-%m-%d') AS d, SUM(CASE WHEN metric = 'occupied_beds' THEN value END) AS occ,
              SUM(CASE WHEN metric = 'total_beds' THEN value END) AS beds, SUM(CASE WHEN metric = 'opd_count' THEN value END) AS op,
              SUM(CASE WHEN metric = 'emergency_cases' THEN value END) AS em
       FROM observations WHERE ${W} GROUP BY d ORDER BY d`, P),
    q(`SELECT place_name AS hospital, MAX(CASE WHEN metric = 'total_beds' THEN value END) AS beds,
              MAX(CASE WHEN metric = 'occupied_beds' THEN value END) AS occ, MAX(CASE WHEN metric = 'bed_occupancy_pct' THEN value END) AS pct,
              MAX(CASE WHEN metric = 'opd_count' THEN value END) AS op, MAX(CASE WHEN metric = 'medicine_status' THEN value END) AS med,
              MAX(CASE WHEN metric = 'medicine_status' THEN detail END) AS med_t, MAX(CASE WHEN metric = 'health_alert_level' THEN value END) AS alert,
              MAX(CASE WHEN metric = 'ambulance_available' THEN value END) AS amb, MAX(CASE WHEN metric = 'doctors_on_roll' THEN value END) AS doctors
       FROM observations WHERE source = 'hospital' AND observed_at >= ? AND observed_at < ? + INTERVAL 1 DAY${a.sql}
       GROUP BY place_name ORDER BY pct DESC`, [end, end, ...a.params]),
    q(`SELECT detail AS disease, SUM(value) AS v FROM observations WHERE ${W} AND metric = 'disease_cases' AND detail IS NOT NULL
       GROUP BY detail ORDER BY v DESC LIMIT 8`, P),
    q(`SELECT place_name AS hospital, DATE_FORMAT(observed_at, '%Y-%m-%d') AS d, value AS lvl FROM observations
       WHERE ${W} AND metric = 'health_alert_level' AND value >= 2 ORDER BY observed_at DESC, value DESC`, P)
  ]);
  const occ = daily.map((r) => (Number(r.beds) ? (Number(r.occ) / Number(r.beds)) * 100 : 0));
  const avgOcc = occ.reduce((x, y) => x + y, 0) / Math.max(1, occ.length);
  const freeBeds = latest.reduce((x, r) => x + (Number(r.beds ?? 0) - Number(r.occ ?? 0)), 0);
  const op = daily.reduce((x, r) => x + Number(r.op ?? 0), 0), em = daily.reduce((x, r) => x + Number(r.em ?? 0), 0);
  const perDay = Math.max(1, daily.length);
  const short = latest.filter((r) => r.med != null && Number(r.med) < 2);
  const noAmb = latest.filter((r) => r.amb != null && Number(r.amb) === 0);
  const critical = alerts.filter((r) => Number(r.lvl) >= 3).length;
  const full = latest.filter((r) => Number(r.pct) >= 90);
  const ALERT = ["None", "Watch", "Warning", "Critical"];
  return {
    ...head, newest: `${end} 00:00:00`,
    kpis: [
      { label: "Bed occupancy", value: pct(avgOcc), sub: `${n(freeBeds)} beds free on ${day(end)}`, tone: avgOcc >= 90 ? "sev" : avgOcc >= 80 ? "high" : "low" },
      { label: "Outpatients", value: n(op), sub: `about ${n(op / perDay)} a day`, tone: "info" },
      { label: "Emergency cases", value: n(em), sub: `about ${n(em / perDay)} a day`, tone: "violet" },
      { label: "Health alerts", value: n(alerts.length), sub: critical ? `${n(critical)} critical` : "none critical", tone: critical ? "sev" : alerts.length ? "high" : "low" },
      { label: "Medicine short", value: n(short.length), sub: `of ${plural(latest.length, "hospital")} · ${n(noAmb.length)} without ambulance`, tone: short.length ? "high" : "low" }
    ],
    charts: [
      daily.length > 2
        ? { kind: "line", title: "Bed occupancy by day", labels: daily.map((r) => day(r.d)), values: occ.map((v) => Math.round(v * 10) / 10), unit: "%" }
        : { kind: "hbar", title: `Bed occupancy by hospital, ${day(end)}`, labels: latest.map((r) => shortHosp(r.hospital)), values: latest.map((r) => Number(r.pct ?? 0)), unit: "%" },
      { kind: "hbar", title: "Cases by disease", labels: diseases.map((r) => r.disease), values: diseases.map((r) => Number(r.v)), unit: "cases" }
    ],
    tables: [{
      title: `Hospitals on ${day(end)}`,
      columns: ["Hospital", "Occupancy", "Free beds", "Outpatients", "Doctors", "Medicine", "Alert"],
      rows: latest.map((r) => [shortHosp(r.hospital), pct(Number(r.pct ?? 0)), n(Number(r.beds ?? 0) - Number(r.occ ?? 0)), n(Number(r.op ?? 0)),
        n(Number(r.doctors ?? 0)), r.med_t ?? "-", ALERT[Number(r.alert ?? 0)] ?? "-"])
    }],
    notes: [
      `Beds were ${pct(avgOcc)} full on average across ${plural(latest.length, "hospital")}${full.length ? `; ${full.map((r) => shortHosp(r.hospital)).slice(0, 3).join(", ")} ${full.length === 1 ? "is" : "are"} 90% full or more on ${day(end)}` : ""}.`,
      diseases.length ? `Most cases were ${diseases[0].disease} (${n(Number(diseases[0].v))})${diseases[1] ? `, then ${diseases[1].disease} (${n(Number(diseases[1].v))})` : ""}.` : null,
      alerts.length ? `${plural(alerts.length, "health alert")} at warning level or above${critical ? `, ${n(critical)} critical` : ""}; the latest at ${shortHosp(alerts[0].hospital)} on ${day(alerts[0].d)}.` : "No hospital raised a warning-level health alert.",
      short.length ? `Medicine stock is limited or critical at ${short.map((r) => shortHosp(r.hospital)).join(", ")}.` : "Medicine stock is available at every hospital.",
      noAmb.length ? `No ambulance available at ${noAmb.map((r) => shortHosp(r.hospital)).join(", ")} on ${day(end)}.` : null
    ].filter(Boolean) as string[]
  };
}
const shortHosp = (name: string) => String(name ?? "").replace(/^(Government|Govt\.?)\s+/i, "").replace(/\s+(Hospital|and Hospital|Medical College and Hospital)$/i, "").slice(0, 32);

// ------------------------------------------------------------------ lakes --

async function lakes(_dept: string, s: InsightScope): Promise<Built> {
  const [m] = await q(`SELECT DATE_FORMAT(MAX(observed_at), '%Y-%m-%d') AS d FROM observations WHERE source = 'pwd' AND metric = 'lake_pct_full'`);
  const head = { title: "Lakes and reservoirs", area: "district" as const, window: windowText(s.period, m?.d ?? null) };
  if (!m?.d) return none(head, "No lake levels are in the store.");
  const end = m.d as string, start = addDays(end, 1 - Math.max(PERIOD_DAYS[s.period], 7));
  const [latest, first, byDay] = await Promise.all([
    q(`SELECT place_name AS name, MAX(CASE WHEN metric = 'lake_pct_full' THEN value END) AS pct,
              MAX(CASE WHEN metric = 'lake_storage_mcft' THEN value END) AS st, MAX(CASE WHEN metric = 'lake_outflow_cusec' THEN value END) AS outq
       FROM observations WHERE source = 'pwd' AND DATE(observed_at) = ? GROUP BY place_name ORDER BY pct DESC`, [end]),
    q(`SELECT place_name AS name, value AS pct FROM observations WHERE source = 'pwd' AND metric = 'lake_pct_full' AND DATE(observed_at) = ?`, [start]),
    q(`SELECT DATE_FORMAT(observed_at, '%Y-%m-%d') AS d, AVG(value) AS v FROM observations
       WHERE source = 'pwd' AND metric = 'lake_pct_full' AND observed_at >= ? AND observed_at < ? + INTERVAL 1 DAY GROUP BY d ORDER BY d`, [start, end])
  ]);
  const was = new Map(first.map((r) => [r.name, Number(r.pct)]));
  const avg = latest.reduce((x, r) => x + Number(r.pct ?? 0), 0) / Math.max(1, latest.length);
  const low = latest.filter((r) => Number(r.pct) < 30), full = latest.filter((r) => Number(r.pct) >= 90);
  const releasing = latest.filter((r) => Number(r.outq ?? 0) > 0);
  const store = latest.reduce((x, r) => x + Number(r.st ?? 0), 0);
  const rising = latest.map((r): Row => ({ ...r, ch: was.has(r.name) ? Number(r.pct) - (was.get(r.name) as number) : null }))
    .filter((r) => r.ch != null).sort((x, y) => Number(y.ch) - Number(x.ch));
  return {
    ...head, newest: `${end} 00:00:00`,
    kpis: [
      { label: "Average storage", value: pct(avg), sub: `${plural(latest.length, "lake")} · ${n(store)} mcft held`, tone: avg < 30 ? "sev" : avg >= 90 ? "high" : "info" },
      { label: "Near full (90%+)", value: n(full.length), sub: full.length ? full.map((r) => r.name).slice(0, 2).join(", ") : "none", tone: full.length ? "high" : "low" },
      { label: "Low (under 30%)", value: n(low.length), sub: low.length ? low.map((r) => r.name).slice(0, 2).join(", ") : "none", tone: low.length ? "sev" : "low" },
      { label: "Releasing surplus", value: n(releasing.length), sub: releasing.length ? `${n(releasing.reduce((x, r) => x + Number(r.outq), 0))} cusec in total` : "no lake releasing", tone: releasing.length ? "violet" : "low" }
    ],
    charts: [
      ...(byDay.length > 2 ? [{ kind: "line" as const, title: "Average storage by day, % of capacity", labels: byDay.map((r) => day(r.d)), values: byDay.map((r) => Math.round(Number(r.v) * 10) / 10), unit: "%" }] : []),
      { kind: "hbar", title: `Storage by lake, ${day(end)}`, labels: latest.map((r) => r.name), values: latest.map((r) => Math.round(Number(r.pct ?? 0))), unit: "% full" }
    ],
    tables: [{
      title: `Lakes on ${day(end)}`,
      columns: ["Lake", "% full", "Storage (mcft)", "Outflow (cusec)", `Change since ${day(start)}`],
      rows: latest.map((r) => {
        const ch = was.has(r.name) ? Number(r.pct) - (was.get(r.name) as number) : null;
        return [r.name, pct(Number(r.pct ?? 0)), n(Number(r.st ?? 0)), n(Number(r.outq ?? 0)), ch == null ? "-" : `${ch >= 0 ? "+" : "−"}${n1(Math.abs(ch))} pts`];
      })
    }],
    notes: [
      `The ${plural(latest.length, "lake")} hold ${pct(avg)} of capacity on average (${day(end)}).`,
      full.length ? `${full.map((r) => r.name).join(", ")} ${full.length === 1 ? "is" : "are"} 90% full or more: watch for surplus release downstream.` : null,
      low.length ? `${low.map((r) => r.name).join(", ")} ${low.length === 1 ? "is" : "are"} below 30%.` : null,
      rising[0] && Number(rising[0].ch) > 0.5 ? `${rising[0].name} rose the most since ${day(start)} (+${n1(Number(rising[0].ch))} points).` : null,
      releasing.length ? `${releasing.map((r) => r.name).slice(0, 3).join(", ")} ${releasing.length === 1 ? "is" : "are"} releasing water.` : "No lake is releasing water."
    ].filter(Boolean) as string[]
  };
}

// -------------------------------------------------------------- PWD works --

async function pwdworks(dept: string, s: InsightScope, now: string): Promise<Built> {
  const buildings = dept === "PWD-BLD";
  const kind = buildings ? "w.work_type LIKE 'building%'" : "w.work_type NOT LIKE 'building%'";
  const head = { title: buildings ? "PWD building works" : "PWD water-resources works", area: (s.taluk ? "filtered" : "district") as "filtered" | "district", window: "Every work in the register" };
  const t = s.taluk ? { sql: " AND w.taluk_code = ?", params: [s.taluk] } : { sql: "", params: [] as unknown[] };
  const today = now.slice(0, 10);
  const ONGOING = `w.status IN ('in_progress', 'on_hold', 'sanctioned')`;
  const [[k], byType, delayed] = await Promise.all([
    q(`SELECT COUNT(*) AS n, SUM(${ONGOING}) AS ongoing, SUM(w.status = 'completed') AS done, SUM(w.status = 'on_hold') AS hold,
              SUM(${ONGOING} AND w.target_date < ?) AS late, SUM(CASE WHEN ${ONGOING} THEN w.sanctioned_amount_lakh END) AS sanc,
              SUM(CASE WHEN ${ONGOING} THEN w.expenditure_lakh END) AS spent, SUM(w.overrun_pct > 0) AS overrun,
              SUM(w.status = 'completed' AND w.completion_date > w.target_date) AS done_late
       FROM pwd_works w WHERE ${kind}${t.sql}`, [today, ...t.params]),
    q(`SELECT w.work_type AS t, SUM(${ONGOING}) AS v FROM pwd_works w WHERE ${kind}${t.sql} GROUP BY w.work_type HAVING v > 0 ORDER BY v DESC`, t.params),
    q(`SELECT w.work_title AS title, w.office, DATE_FORMAT(w.target_date, '%Y-%m-%d') AS target, w.physical_progress_pct AS prog,
              w.expenditure_lakh AS spent, w.sanctioned_amount_lakh AS sanc, w.status, DATEDIFF(?, w.target_date) AS late_days
       FROM pwd_works w WHERE ${kind}${t.sql} AND ${ONGOING} AND w.target_date < ? ORDER BY w.target_date LIMIT 12`, [today, ...t.params, today])
  ]);
  if (!Number(k?.n)) return none(head, "No works in the PWD register for this department and area.");
  const late = Number(k.late ?? 0), ongoing = Number(k.ongoing ?? 0);
  return {
    // the register is rebuilt with every store build, so it is as new as the store
    ...head, newest: now,
    kpis: [
      { label: "Works under way", value: n(ongoing), sub: `${n(Number(k.done ?? 0))} completed · ${n(Number(k.hold ?? 0))} on hold`, tone: "info" },
      { label: "Past target date", value: n(late), sub: ongoing ? `${pct((late / ongoing) * 100)} of works under way` : "none under way", tone: late ? "sev" : "low" },
      { label: "Spent", value: `₹${n(Number(k.spent ?? 0))} L`, sub: `of ₹${n(Number(k.sanc ?? 0))} lakh sanctioned`, tone: "violet" },
      { label: "Cost overrun", value: n(Number(k.overrun ?? 0)), sub: `${n(Number(k.done_late ?? 0))} finished after target`, tone: Number(k.overrun) ? "high" : "low" }
    ],
    charts: [{ kind: "hbar", title: "Works under way, by type", labels: byType.map((r) => LABEL(r.t)), values: byType.map((r) => Number(r.v)), unit: "works" }],
    tables: [{
      title: "Works past their target date",
      columns: ["Work", "Office", "Target", "Days late", "Progress", "Spent / sanctioned (₹ lakh)"],
      rows: delayed.map((r) => [r.title, r.office ?? "-", day(r.target), n(Number(r.late_days ?? 0)), pct(Number(r.prog ?? 0)), `${n(Number(r.spent ?? 0))} / ${n(Number(r.sanc ?? 0))}`])
    }],
    notes: [
      `${plural(ongoing, "work")} ${ongoing === 1 ? "is" : "are"} under way, with ₹${n(Number(k.spent ?? 0))} lakh spent of ₹${n(Number(k.sanc ?? 0))} lakh sanctioned.`,
      late ? `${plural(late, "work")} ${late === 1 ? "is" : "are"} past the target date; the oldest target was ${day(delayed[0].target)} (${delayed[0].title}).` : "No work under way is past its target date.",
      byType[0] ? `Most works under way are ${LABEL(byType[0].t).toLowerCase()} (${n(Number(byType[0].v))}).` : null,
      Number(k.overrun) ? `${plural(Number(k.overrun), "work")} ran over the sanctioned cost.` : null
    ].filter(Boolean) as string[]
  };
}

// -------------------------------------------------------- PWD field records --

async function pwdfield(dept: string, s: InsightScope): Promise<Built> {
  const [m] = await q(`SELECT ${fmt("MAX(reported_at)")} AS t FROM events WHERE source = 'pwd' AND lead_dept = ?`, [dept]);
  const newest = (m?.t as string | null) ?? null;
  const head = { title: "PWD field records", area: "filtered" as const, window: windowText(s.period, newest) };
  if (!newest) return none(head, "No PWD field records for this department.");
  const a = areaSql(s, "e");
  const w = periodWindow(s.period, newest, "e.reported_at");
  const W = `e.source = 'pwd' AND e.lead_dept = ? AND ${w.sql}${a.sql}`, P = [dept, ...w.params, ...a.params];
  const [[k], byCat, byTaluk] = await Promise.all([
    q(`SELECT COUNT(*) AS n, SUM(e.status_std <> 'Resolved') AS open, SUM(COALESCE(e.persons_affected, 0)) AS people,
              SUM(e.severity_level IN ('Severe', 'High')) AS serious, SUM(e.access_blocked = 1) AS blocked
       FROM events e WHERE ${W}`, P),
    q(`SELECT COALESCE(c.label, e.category_code) AS l, COUNT(*) AS v FROM events e LEFT JOIN ref_categories c ON c.category_code = e.category_code
       WHERE ${W} GROUP BY l ORDER BY v DESC LIMIT 8`, P),
    q(`SELECT COALESCE(t.name, e.taluk_code) AS l, COUNT(*) AS v, SUM(e.status_std <> 'Resolved') AS open FROM events e
       LEFT JOIN ref_taluks t ON t.taluk_code = e.taluk_code WHERE ${W} AND e.taluk_code IS NOT NULL GROUP BY l ORDER BY v DESC LIMIT 8`, P)
  ]);
  const total = Number(k?.n ?? 0);
  if (!total) return none(head, "No PWD field records in this period and area.", newest);
  return {
    ...head, newest,
    kpis: [
      { label: "Field records", value: n(total), sub: `${n(Number(k.open ?? 0))} still open`, tone: "info" },
      { label: "Severe or high", value: n(Number(k.serious ?? 0)), sub: "by the pipeline's severity rules", tone: Number(k.serious) ? "sev" : "low" },
      { label: "People affected", value: n(Number(k.people ?? 0)), sub: `${n(Number(k.blocked ?? 0))} blocked roads or access`, tone: "violet" }
    ],
    charts: [
      { kind: "hbar", title: "Records by type", labels: byCat.map((r) => r.l), values: byCat.map((r) => Number(r.v)), unit: "records" },
      { kind: "hbar", title: "Records by taluk", labels: byTaluk.map((r) => r.l), values: byTaluk.map((r) => Number(r.v)), unit: "records" }
    ],
    tables: [],
    notes: [
      `${plural(total, "field record")} were logged, ${n(Number(k.open ?? 0))} still open; most were ${String(byCat[0]?.l ?? "—").toLowerCase()} (${n(Number(byCat[0]?.v ?? 0))}).`,
      byTaluk[0] ? `${byTaluk[0].l} taluk had the most (${n(Number(byTaluk[0].v))}, ${n(Number(byTaluk[0].open ?? 0))} open).` : null,
      Number(k.people) ? `${n(Number(k.people))} people were affected.` : null
    ].filter(Boolean) as string[]
  };
}

// ---------------------------------------------------------------- weather --

const WARN = ["Green", "Yellow", "Orange", "Red"];
const WARN_TONE: InsightKpi["tone"][] = ["low", "med", "high", "sev"];

async function weather(_dept: string, s: InsightScope, now: string): Promise<Built> {
  const [m] = await q(`SELECT ${fmt("MAX(observed_at)")} AS t FROM observations WHERE source = 'imd' AND metric <> 'imd_warning_level' AND observed_at <= ?`, [now]);
  const newest = (m?.t as string | null) ?? null;
  const head = { title: "Rain, warnings and reservoir inflow", area: "district" as const, window: windowText(s.period, newest) };
  if (!newest) return none(head, "No IMD readings are in the store.");
  // at least a week, so a single dry day still shows the recent rain
  const w = periodWindow(s.period === "daily" ? "weekly" : s.period, newest, "observed_at");
  const [rain, warns, temps, inflow, [cfmNew]] = await Promise.all([
    q(`SELECT place_name AS st, SUM(value) AS mm, MAX(value) AS peak FROM observations WHERE source = 'imd' AND metric = 'rainfall_24h_mm' AND ${w.sql}
       GROUP BY place_name ORDER BY mm DESC`, w.params),
    q(`SELECT DATE_FORMAT(observed_at, '%Y-%m-%d') AS d, MAX(value) AS lvl, MAX(detail) AS txt FROM observations
       WHERE source = 'imd' AND metric = 'imd_warning_level' AND observed_at >= DATE(?) - INTERVAL 1 DAY GROUP BY d ORDER BY d LIMIT 6`, [now]),
    q(`SELECT place_name AS st, MAX(value) AS v FROM observations WHERE source = 'imd' AND metric = 'temp_max_c' AND ${w.sql} GROUP BY place_name ORDER BY v DESC`, w.params),
    q(`SELECT DATE_FORMAT(observed_at, '%Y-%m-%d') AS d, SUM(value) AS v FROM observations WHERE source = 'cfm' AND metric = 'reservoir_inflow_cusec'
       AND observed_at > (SELECT MAX(observed_at) FROM observations WHERE source = 'cfm' AND metric = 'reservoir_inflow_cusec') - INTERVAL ? DAY
       GROUP BY d ORDER BY d`, [Math.max(7, PERIOD_DAYS[s.period])]),
    q(`SELECT ${fmt("MAX(observed_at)")} AS t FROM observations WHERE source = 'cfm' AND metric = 'reservoir_inflow_cusec'`)
  ]);
  const ahead = warns.filter((x) => x.d >= now.slice(0, 10));
  const worst = [...ahead].sort((x, y) => Number(y.lvl) - Number(x.lvl))[0];
  const total = rain.reduce((x, r) => x + Number(r.mm ?? 0), 0);
  const wet = rain.filter((r) => Number(r.mm) > 0);
  const hot = temps[0];
  const lastIn = inflow[inflow.length - 1];
  return {
    ...head, newest,
    kpis: [
      { label: "IMD warning ahead", value: worst ? WARN[Number(worst.lvl)] ?? "-" : "None", sub: worst ? `${day(worst.d)} · ${worst.txt ?? ""}` : "no warning issued", tone: worst ? WARN_TONE[Number(worst.lvl)] ?? "info" : "low" },
      { label: "Rainfall", value: wet.length ? `${n1(Number(wet[0].mm))} mm` : "None", sub: wet.length ? `most at ${String(wet[0].st).replace(/^Chennai-/, "")}` : "no gauge recorded rain", tone: "info" },
      ...(hot ? [{ label: "Highest temperature", value: `${n1(Number(hot.v))} °C`, sub: String(hot.st).replace(/^Chennai-/, ""), tone: (Number(hot.v) >= 38 ? "high" : "info") as InsightKpi["tone"] }] : []),
      ...(lastIn ? [{ label: "Reservoir inflow", value: `${n(Number(lastIn.v))} cusec`, sub: `CFM-DSS, ${day(lastIn.d)}`, tone: "violet" as const }] : [])
    ],
    charts: [
      ...(wet.length ? [{ kind: "hbar" as const, title: "Rainfall by gauge (mm)", labels: wet.map((r) => String(r.st).replace(/^Chennai-/, "")), values: wet.map((r) => Math.round(Number(r.mm) * 10) / 10), unit: "mm" }] : []),
      ...(inflow.length > 1 ? [{ kind: "line" as const, title: "Reservoir inflow by day (cusec)", labels: inflow.map((r) => day(r.d)), values: inflow.map((r) => Math.round(Number(r.v))), unit: "cusec" }] : [])
    ],
    tables: [{ title: "IMD district warnings", columns: ["Day", "Level", "Warning"], rows: warns.map((x) => [day(x.d), WARN[Number(x.lvl)] ?? "-", x.txt ?? "-"]) }],
    notes: [
      worst && Number(worst.lvl) > 0 ? `IMD has a ${WARN[Number(worst.lvl)].toLowerCase()} warning for ${day(worst.d)} (${worst.txt}).` : "IMD has no warning for Chennai in the coming days.",
      wet.length ? `${n1(total)} mm of rain was recorded across ${plural(wet.length, "gauge")}; ${String(wet[0].st).replace(/^Chennai-/, "")} had the most (${n1(Number(wet[0].mm))} mm).` : "No rain was recorded at the IMD gauges.",
      lastIn ? `Reservoir inflow was ${n(Number(lastIn.v))} cusec on ${day(lastIn.d)} (CFM-DSS${cfmNew?.t && hoursBetween(cfmNew.t, now) > STALE_HOURS ? ", not updated since" : ""}).` : null
    ].filter(Boolean) as string[]
  };
}

// -------------------------------------------------------------------- air --

const aqiBand = (a: number) => (a <= 50 ? "Good" : a <= 100 ? "Satisfactory" : a <= 200 ? "Moderate" : a <= 300 ? "Poor" : a <= 400 ? "Very poor" : "Severe");
const aqiTone = (a: number): InsightKpi["tone"] => (a <= 100 ? "low" : a <= 200 ? "med" : a <= 300 ? "high" : "sev");
const cleanSt = (st: string) => String(st).replace(/, Chennai - (TNPCB|CPCB|IMD)$/, "").replace(/^Chennai-/, "");

async function air(_dept: string, s: InsightScope): Promise<Built> {
  const [m] = await q(`SELECT ${fmt("MAX(observed_at)")} AS t FROM observations WHERE source = 'cpcb' AND metric = 'aqi'`);
  const newest = (m?.t as string | null) ?? null;
  const head = { title: "Air quality", area: "district" as const, window: windowText(s.period, newest) };
  if (!newest) return none(head, "No air-quality readings are in the store.");
  const w = periodWindow(s.period === "daily" ? "weekly" : s.period, newest, "observed_at");
  const [latest, byDay, [cnt], [comp]] = await Promise.all([
    q(`SELECT place_name AS st, value AS aqi, detail FROM (
         SELECT o.*, ROW_NUMBER() OVER (PARTITION BY place_id ORDER BY observed_at DESC) rn FROM observations o
         WHERE source = 'cpcb' AND metric = 'aqi' AND ${w.sql}) x WHERE rn = 1 ORDER BY aqi DESC`, w.params),
    q(`SELECT DATE_FORMAT(observed_at, '%Y-%m-%d') AS d, AVG(value) AS a FROM observations WHERE source = 'cpcb' AND metric = 'aqi' AND ${w.sql} GROUP BY d ORDER BY d`, w.params),
    q(`SELECT COUNT(*) AS n, SUM(value > 100) AS bad FROM observations WHERE source = 'cpcb' AND metric = 'aqi' AND ${w.sql}`, w.params),
    q(`SELECT COUNT(*) AS n FROM incidents i WHERE i.category_code = 'AIR_POLLUTION' AND ${periodWindow(s.period, newest, "i.first_reported_at").sql}`,
      periodWindow(s.period, newest, "i.first_reported_at").params)
  ]);
  if (!latest.length) return none(head, "No air-quality reading in this window.", newest);
  const avg = latest.reduce((x, r) => x + Number(r.aqi), 0) / latest.length;
  const worst = latest[0], best = latest[latest.length - 1];
  return {
    ...head, newest,
    kpis: [
      { label: "Average AQI", value: n(avg), sub: aqiBand(avg), tone: aqiTone(avg) },
      { label: "Worst station", value: n(Number(worst.aqi)), sub: `${cleanSt(worst.st)} · ${aqiBand(Number(worst.aqi))}`, tone: aqiTone(Number(worst.aqi)) },
      { label: "Readings above 100", value: n(Number(cnt?.bad ?? 0)), sub: `of ${n(Number(cnt?.n ?? 0))} readings`, tone: Number(cnt?.bad) ? "high" : "low" },
      { label: "Air-pollution complaints", value: n(Number(comp?.n ?? 0)), sub: "from citizens, same period", tone: "violet" }
    ],
    charts: [
      { kind: "hbar", title: "Latest AQI by station", labels: latest.map((r) => cleanSt(r.st)), values: latest.map((r) => Math.round(Number(r.aqi))), unit: "AQI" },
      ...(byDay.length > 1 ? [{ kind: "line" as const, title: "Average AQI by day", labels: byDay.map((r) => day(r.d)), values: byDay.map((r) => Math.round(Number(r.a))), unit: "AQI" }] : [])
    ],
    tables: [],
    notes: [
      `Air across ${plural(latest.length, "station")} averages ${n(avg)} AQI (${aqiBand(avg).toLowerCase()}).`,
      `${cleanSt(worst.st)} reads highest at ${n(Number(worst.aqi))}; ${cleanSt(best.st)} lowest at ${n(Number(best.aqi))}.`,
      Number(comp?.n) ? `${plural(Number(comp.n), "citizen complaint")} about air pollution in the same period.` : null
    ].filter(Boolean) as string[]
  };
}

// ---------------------------------------------------------------- markets --

async function markets(_dept: string, s: InsightScope): Promise<Built> {
  let last: Row | undefined;
  try {
    [last] = await q(`SELECT DATE_FORMAT(MAX(date), '%Y-%m-%d') AS d FROM ${ops("mandi_market_prices")}`);
  } catch {
    last = undefined; // the market tables are created by the Collector console's setup (npm run setup:ops)
  }
  const head = { title: "Food prices in Chennai markets", area: "district" as const, window: last?.d ? `Prices on ${day(last.d)}, against a week earlier` : "No records" };
  if (!last?.d) return none(head, "No market prices are in the store yet.");
  const end = last.d as string;
  const [rows, [mk]] = await Promise.all([
    q(`SELECT c.commodity, c.cmdt_group AS grp, c.p, c.markets, (SELECT AVG(o.modal_price) FROM ${ops("mandi_market_prices")} o
              WHERE o.commodity = c.commodity AND o.date BETWEEN ? - INTERVAL 9 DAY AND ? - INTERVAL 5 DAY) AS prev
       FROM (SELECT commodity, MAX(cmdt_group) AS cmdt_group, AVG(modal_price) AS p, COUNT(DISTINCT market) AS markets
             FROM ${ops("mandi_market_prices")} WHERE date = ? GROUP BY commodity) c
       WHERE c.markets >= 2 ORDER BY c.markets DESC, c.commodity LIMIT 60`, [end, end, end]),
    q(`SELECT COUNT(DISTINCT market) AS n FROM ${ops("mandi_market_prices")} WHERE date = ?`, [end])
  ]);
  const withCh = rows.filter((r) => r.prev != null && Number(r.prev) > 0).map((r): Row => ({ ...r, ch: ((Number(r.p) - Number(r.prev)) / Number(r.prev)) * 100 }));
  const up = [...withCh].sort((x, y) => y.ch - x.ch).filter((r) => r.ch > 0);
  const down = [...withCh].sort((x, y) => x.ch - y.ch).filter((r) => r.ch < 0);
  const staple = ["Tomato", "Onion", "Potato"].map((c) => rows.find((r) => String(r.commodity).startsWith(c))).filter(Boolean) as Row[];
  const rs = (v: number) => `₹${n(v)}`;
  return {
    ...head, newest: `${end} 00:00:00`,
    kpis: [
      { label: "Markets reporting", value: n(Number(mk?.n ?? 0)), sub: `${plural(rows.length, "commodity", "commodities")} priced in 2+ markets`, tone: "info" },
      ...staple.map((r) => {
        const c = withCh.find((x) => x.commodity === r.commodity);
        return { label: String(r.commodity), value: `${rs(Number(r.p))}/q`, sub: c ? `${c.ch >= 0 ? "+" : "−"}${pct(Math.abs(c.ch))} on the week` : "no price a week earlier", tone: (c && c.ch >= 15 ? "high" : "low") as InsightKpi["tone"] };
      }),
      { label: "Rising 15%+", value: n(up.filter((r) => r.ch >= 15).length), sub: up[0] ? `most: ${up[0].commodity} +${pct(up[0].ch)}` : "none", tone: up.some((r) => r.ch >= 15) ? "sev" : "low" }
    ],
    charts: [{ kind: "hbar", title: "Biggest weekly rises (%)", labels: up.slice(0, 8).map((r) => r.commodity), values: up.slice(0, 8).map((r) => Math.round(r.ch)), unit: "%" }],
    tables: [{
      title: `Prices on ${day(end)} (modal, ₹ per quintal, average of the markets)`,
      columns: ["Commodity", "Group", "Price", "A week earlier", "Change", "Markets"],
      rows: [...withCh].sort((x, y) => Math.abs(y.ch) - Math.abs(x.ch)).slice(0, 20)
        .map((r) => [r.commodity, r.grp ?? "-", rs(Number(r.p)), rs(Number(r.prev)), `${r.ch >= 0 ? "+" : "−"}${pct(Math.abs(r.ch))}`, n(Number(r.markets))])
    }],
    notes: [
      staple.length ? `Staples: ${staple.map((r) => `${r.commodity} ${rs(Number(r.p))}/q`).join(", ")} (${day(end)}).` : null,
      up[0] ? `${up.slice(0, 3).map((r) => `${r.commodity} (+${pct(r.ch)})`).join(", ")} rose the most in a week.` : "No commodity rose on the week.",
      down[0] ? `${down.slice(0, 3).map((r) => `${r.commodity} (−${pct(Math.abs(r.ch))})`).join(", ")} fell the most.` : null
    ].filter(Boolean) as string[]
  };
}
