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
import intelPool, { OPS_DB, ops } from "@/lib/collector/db";
import { addedItems, collectionStatus } from "@/lib/collector/sources";
import { photoUrl } from "@/lib/officer/photos";
import { threads } from "@/lib/collector/threads";

type Row = Record<string, any>;

async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await intelPool.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}

export const PERIODS = {
  daily: { hours: 24, buckets: 12, unit: "Day", prev: "yesterday", label: "Today", word: "Daily" },
  weekly: { hours: 168, buckets: 7, unit: "Week", prev: "prev. week", label: "Last 7 days", word: "Weekly" },
  monthly: { hours: 720, buckets: 30, unit: "Month", prev: "prev. month", label: "Last 30 days", word: "Monthly" },
  quarterly: { hours: 2160, buckets: 13, unit: "Quarter", prev: "prev. quarter", label: "Last 90 days", word: "Quarterly" }
} as const;
export type Period = keyof typeof PERIODS;
export type Overview = Awaited<ReturnType<typeof overview>>;
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
export function parseCat(v: unknown): string | null {
  return typeof v === "string" && /^[A-Z_]{3,40}$/.test(v) ? v : null;
}
export function parseTaluk(v: unknown): string | null {
  return typeof v === "string" && /^TLK-[A-Z]{3}$/.test(v) ? v : null;
}
/** Extra cross-filters: a category chosen from a chart, a taluk chosen from the map or ranking. */
export interface Focus { cat?: string | null; taluk?: string | null }

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

export interface Scope {
  period: Period;
  zone: number | null;
  dept?: string | null;
  cat?: string | null;
  taluk?: string | null;
  offset?: number; // 1 = the previous window
}

/**
 * The time window of a period over a timestamp column. Daily is today: the calendar day of
 * the as-of time, from midnight (offset 1 = yesterday), so nothing from earlier days shows.
 * Weekly, monthly and quarterly are the last 7, 30 and 90 days. `hours` forces a rolling window.
 */
export function periodWindow(period: Period, now: string, col = "i.first_reported_at", off = 0, hours?: number): { sql: string; params: unknown[] } {
  if (period === "daily" && hours == null) {
    return off === 0
      ? { sql: `${col} >= DATE(?) AND ${col} <= ?`, params: [now, now] }
      : { sql: `${col} >= DATE(?) - INTERVAL ? DAY AND ${col} < DATE(?) - INTERVAL ? DAY`, params: [now, off, now, off - 1] };
  }
  const h = hours ?? PERIODS[period].hours;
  return { sql: `${col} > (? - INTERVAL ? HOUR) AND ${col} <= (? - INTERVAL ? HOUR)`, params: [now, h * (off + 1), now, h * off] };
}

/** Start of the period as an IST wall-clock string ("YYYY-MM-DD HH:MM:SS"). */
export function periodSince(period: Period, now: string): string {
  if (period === "daily") return `${now.slice(0, 10)} 00:00:00`;
  const t = new Date(now.replace(" ", "T") + "Z").getTime() - PERIODS[period].hours * 3600_000;
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

/** WHERE clause over `incidents i` for a period window, zone and department. */
export function scopeWhere(s: Scope, now: string): { sql: string; params: unknown[] } {
  const win = periodWindow(s.period, now, "i.first_reported_at", s.offset ?? 0);
  const parts = [win.sql];
  const params: unknown[] = [...win.params];
  if (s.zone) {
    parts.push(`i.zone_no = ?`);
    params.push(s.zone);
  }
  if (s.dept) {
    parts.push(`i.lead_dept = ?`);
    params.push(s.dept);
  }
  if (s.cat) {
    parts.push(`i.category_code = ?`);
    params.push(s.cat);
  }
  if (s.taluk) {
    parts.push(`i.taluk_code = ?`);
    params.push(s.taluk);
  }
  return { sql: parts.join(" AND "), params };
}

const SEV_RANK = `FIELD(i.severity_level, 'Severe', 'High', 'Medium', 'Low')`;
/**
 * Closed-work checks the Collector does personally. The rest (low or medium severity,
 * one or two complaints, one department, closed near its deadline) are left to the
 * department head, so My Tasks holds only the closures worth the Collector's time.
 */
const FOR_COLLECTOR = `(i.severity_level IN ('Severe', 'High') OR i.citizen_complaints >= 3
  OR i.attention_reason LIKE '%several departments%' OR i.sources LIKE '%news%'
  OR (i.severity_level = 'Medium' AND i.priority_reasons LIKE '%resolution over twice%'))`;

/** Which of the FOR_COLLECTOR rules put a task on the Collector's list, in words. */
function taskBecause(r: Row): string[] {
  const out: string[] = [];
  if (Number(r.officer_sent)) out.push("Department sent a completion report");
  if (r.sev === "Severe" || r.sev === "High") out.push(`${r.sev} severity`);
  if (Number(r.complaints) >= 3) out.push(`${r.complaints} citizens complained`);
  if (/several departments/i.test(String(r.attention_reason ?? ""))) out.push("Several departments");
  if (/news/.test(String(r.sources ?? ""))) out.push("In the news");
  if (r.sev === "Medium" && /resolution over twice/i.test(String(r.priority_reasons ?? ""))) out.push("Took over twice its deadline");
  return out;
}

const DECIDED = (decisions: string) =>
  `EXISTS (SELECT 1 FROM ${ops("collector_decisions")} d WHERE d.incident_id = i.incident_id AND d.decision IN (${decisions}))`;

// ---- Shared with the Department Officer console (src/lib/officer): completion reports officers send.
// A grievance waits for the Collector when the department's latest officer step is "send" and the
// Collector has not verified, returned, resolved or rejected it since. Such a report always comes to
// My Tasks (the officer asked for the Collector's check), whatever the period. Only used once the
// officer tables exist (npm run setup:officer), so the console behaves exactly as before without them.
let officerOpsCache: { at: number; ready: boolean } | null = null;
async function officerOpsReady(): Promise<boolean> {
  if (officerOpsCache && Date.now() - officerOpsCache.at < 60_000) return officerOpsCache.ready;
  const r = await q(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('officer_steps', 'officer_reports')`, [OPS_DB]);
  officerOpsCache = { at: Date.now(), ready: Number(r[0]?.n) === 2 };
  return officerOpsCache.ready;
}
const SENT_BY_OFFICER = `EXISTS (SELECT 1 FROM ${ops("officer_steps")} s WHERE s.incident_id = i.incident_id AND s.step = 'send'
    AND NOT EXISTS (SELECT 1 FROM ${ops("officer_steps")} s2 WHERE s2.incident_id = s.incident_id AND (s2.at > s.at OR (s2.at = s.at AND s2.step_id > s.step_id)))
    AND NOT EXISTS (SELECT 1 FROM ${ops("collector_decisions")} d WHERE d.incident_id = s.incident_id
                    AND d.decision IN ('verify', 'reject', 'resolve', 'reopen') AND d.decided_at >= s.at))`;
/** Open and sent to the Collector from the officer console, not yet decided; FALSE without the officer tables. */
async function sentByOfficer(): Promise<string> {
  return (await officerOpsReady()) ? `(i.is_open = 1 AND ${SENT_BY_OFFICER})` : "(1 = 0)";
}

/** The officer's latest completion report per incident, for the task card. */
async function officerReports(ids: string[]): Promise<Record<string, Row>> {
  if (!ids.length || !(await officerOpsReady())) return {};
  const r = await q(
    `SELECT id, t, note, actor, photos FROM (
       SELECT incident_id AS id, DATE_FORMAT(sent_at, '%Y-%m-%d %H:%i:%s') AS t, remarks AS note, sent_by AS actor, photos,
              ROW_NUMBER() OVER (PARTITION BY incident_id ORDER BY sent_at DESC, report_id DESC) rn
       FROM ${ops("officer_reports")} WHERE incident_id IN (?)) x WHERE rn = 1`,
    [ids]
  );
  return Object.fromEntries(r.map((x) => {
    const photos: string[] = Array.isArray(x.photos) ? x.photos : JSON.parse(String(x.photos || "[]"));
    return [x.id, { id: x.id, t: x.t, note: x.note, actor: x.actor, step: "Completion report", photos: photos.length }];
  }));
}

/** Every completion report the department sent for one incident, newest first, with its photos. */
async function officerReportsFull(id: string): Promise<Row[]> {
  if (!(await officerOpsReady())) return [];
  const r = await q(
    `SELECT r.report_id AS rid, r.dept_code, dp.name AS dept_name, r.remarks, r.photo_dir, r.photos, r.sent_by,
            DATE_FORMAT(r.sent_at, '%Y-%m-%d %H:%i:%s') AS t
     FROM ${ops("officer_reports")} r LEFT JOIN ref_departments dp ON dp.code = r.dept_code
     WHERE r.incident_id = ? ORDER BY r.sent_at DESC, r.report_id DESC`,
    [id]
  );
  return r.map((x) => {
    const names: string[] = Array.isArray(x.photos) ? x.photos : JSON.parse(String(x.photos || "[]"));
    return { id: Number(x.rid), dept: x.dept_name ?? x.dept_code, remarks: String(x.remarks), by: String(x.sent_by), t: String(x.t),
      photos: names.map((nm) => photoUrl(String(x.photo_dir), nm)) };
  });
}

/** Columns every incident row on the console carries. */
const ROW = `i.incident_id AS id, i.title, i.category_label AS type, i.category_code AS cat_code, i.family,
  i.lead_dept AS dept, dp.name AS dept_name, i.zone_no AS zone, i.zone_name, i.ward_no AS ward, i.place_text AS loc,
  i.lat, i.lon, i.severity_level AS sev, i.status_std AS status, i.is_open AS open, i.verified,
  i.citizen_complaints AS complaints, i.outlet_count AS outlets, i.sources, i.source_count, i.channels,
  DATE_FORMAT(i.first_reported_at, '%Y-%m-%d %H:%i:%s') AS t, i.summary, i.priority_score AS priority,
  i.sla_breached AS breached, i.hours_open, i.severity_reasons, i.priority_reasons, i.attention_reason, i.officer,
  i.media_only, i.awaiting_collector, i.police_reports, DATE_FORMAT(i.last_update_at, '%Y-%m-%d %H:%i:%s') AS updated`;
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

/**
 * Linked reports per incident, by source, from the dedup store: how many
 * citizen complaints, police and PWD records, hospital reports, and which news
 * outlets (distinct publishers, not articles) were merged into each incident.
 * Every panel shows these same numbers, so an incident reads the same everywhere.
 */
export interface SourceCounts { grievance: number; police: number; pwd: number; hospital: number; imd: number; news: number; outlets: string[]; total: number }

async function sourcesFor(ids: string[]): Promise<Record<string, SourceCounts>> {
  if (!ids.length) return {};
  const [m, d] = await Promise.all([
    q(`SELECT incident_id AS id, source, COUNT(*) AS n FROM incident_members WHERE incident_id IN (?) GROUP BY incident_id, source`, [ids]),
    q(
      // outlets = publishers of the linked articles and of every article in the same news story
      `SELECT d1.linked_incident_id AS id, GROUP_CONCAT(DISTINCT d2.publisher ORDER BY d2.publisher SEPARATOR '|') AS p
       FROM documents d1 JOIN documents d2 ON d2.story_id = d1.story_id OR d2.doc_id = d1.doc_id
       WHERE d1.linked_incident_id IN (?) AND d2.publisher IS NOT NULL GROUP BY d1.linked_incident_id`,
      [ids]
    )
  ]);
  const out: Record<string, SourceCounts> = {};
  const get = (id: string) => (out[id] ||= { grievance: 0, police: 0, pwd: 0, hospital: 0, imd: 0, news: 0, outlets: [], total: 0 });
  for (const r of m) {
    const s = get(r.id);
    if (r.source in s) (s as any)[r.source] = Number(r.n);
    s.total += Number(r.n);
  }
  for (const r of d) get(r.id).outlets = String(r.p).split("|").filter(Boolean);
  return out;
}

async function withSources<T extends Row>(rows: T[]): Promise<T[]> {
  const s = await sourcesFor(rows.map((r) => r.id));
  return rows.map((r) => {
    const src = s[r.id];
    return { ...r, src, outlets: src ? Math.max(src.outlets.length, src.news ? 1 : 0) : Number(r.outlets ?? 0) };
  });
}

/** An incident in plain words for the Collector. */
export interface Plain {
  /** one sentence: what happened and where */
  summary: string;
  /** short facts: people affected, injuries, road blocked, nearby school... */
  facts: string[];
  /** why the Collector should look at it; empty when the department can handle it alone */
  attention: string[];
  needsYou: boolean;
  /** kept for the PDF and the Markdown briefing: facts and attention */
  what: string[];
  why: string[];
}

const PLACE_WORD: Record<string, string> = { school: "a school", worship: "a place of worship", hospital: "a hospital", bus_stop: "a bus stop" };
const PEOPLE_WORD: Record<string, string> = { children: "children", elderly: "elderly people" };
const andList = (a: string[]) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Turns the pipeline's scoring notes into plain words: one sentence on what happened,
 * a few short facts, and the reasons it needs the Collector. Reasons are listed only
 * when the incident is open and either serious (severe or high) or has a strong signal
 * (well past its deadline, needs several departments, in the news with no department
 * record, deaths); everything else is left to the department and shows no reasons.
 */
export function explain(r: Row): Plain {
  const notes = String(r.severity_reasons ?? "").split(";").map((s) => s.replace(/\s*\([^)]*\)\s*$/, "").trim()).filter(Boolean);
  const pr = String(r.priority_reasons ?? "").split(";").slice(1).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const flags = String(r.attention_reason ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const facts: string[] = [];
  let cause: string | null = null;
  let m: RegExpMatchArray | null;
  for (const raw of notes) {
    const n = raw.toLowerCase();
    if ((m = n.match(/^(\d+) fatalit/))) facts.push(`${m[1]} ${m[1] === "1" ? "death" : "deaths"}`);
    else if ((m = n.match(/^(\d+) injured/))) facts.push(`${m[1]} ${m[1] === "1" ? "person" : "people"} injured`);
    else if ((m = n.match(/^about (\d+) people affected/))) facts.push(`About ${Number(m[1]).toLocaleString("en-IN")} people affected`);
    else if ((m = n.match(/^road blocked (\d+) min/))) facts.push(`Road blocked for ${m[1]} minutes`);
    else if (n === "full service disruption") facts.push("Service fully cut off");
    else if (n === "partial service disruption") facts.push("Service partly disrupted");
    else if (n === "access blocked") facts.push("Access blocked");
    else if (n === "traffic obstruction") facts.push("Traffic held up");
    else if (n === "vulnerable victim") facts.push("Victim is a child, woman or elderly person");
    else if (n === "weapon involved") facts.push("A weapon was used");
    else if (n === "describes an immediate hazard") facts.push("Reported as an immediate danger");
    else if (n === "citizen reports complaining before") facts.push("People had complained about it before");
    else if (n === "weather emergency") facts.push("During a weather warning");
    else if (n.startsWith("affects ")) {
      const k = n.slice(8).split(/,\s*/);
      const places = k.map((x) => PLACE_WORD[x]).filter(Boolean), people = k.map((x) => PEOPLE_WORD[x]).filter(Boolean);
      if (places.length) facts.push(`Near ${andList(places)}`);
      if (people.length) facts.push(`${cap(andList(people))} affected`);
    } else if (!cause) {
      const c = n.replace(/^(public-safety or sanitation issue|civic issue|high-risk issue):\s*/, "");
      if (c && !/^other\b/.test(c)) cause = /^(civic issue|public-safety)/.test(n) ? `complaint about ${c}` : c;
    }
  }
  if (pr.some((p) => p === "linked to a rain event")) facts.push("During rain");

  // "22Nd Link Street, Indira Nagar, Indira Nagar" + zone: each part once
  const parts: string[] = [];
  for (const x of [...String(r.loc ?? "").split(/\s*,\s*/), String(r.zone_name ?? "")]) {
    if (x && !parts.some((y) => y.toLowerCase() === x.toLowerCase() || y.toLowerCase().includes(`(${x.toLowerCase()}`))) parts.push(x);
  }
  const place = parts.join(", ") || "Chennai";
  const summary = `${cap(cause ?? String(r.type ?? "Incident").toLowerCase())} at ${place}.`;

  // Reasons for the Collector, strongest first.
  const why: [number, string][] = [];
  const add = (w: number, s: string) => { if (!why.some(([, x]) => x === s)) why.push([w, s]); };
  const sev = String(r.sev ?? r.severity_level ?? "");
  const serious = sev === "Severe" || sev === "High";
  const deaths = facts.find((f) => /deaths?$/.test(f));
  if (deaths) add(100, `${deaths.replace(/ deaths?$/, "")} ${/^1 /.test(deaths) ? "person has" : "people have"} died`);
  for (const p of pr) {
    if ((m = p.match(/^resolution over twice the (\d+) h target/))) add(90, `Still open at more than twice its ${m[1]}-hour deadline`);
    else if ((m = p.match(/^resolution past the (\d+) h target/))) add(60, `Past its ${m[1]}-hour deadline`);
    else if ((m = p.match(/^response (over twice|past) the (\d+) h target/))) add(70, `No response yet within the ${m[2]}-hour target`);
    else if (p === "not yet verified by an officer" && serious) add(75, "No officer has confirmed it on the ground yet");
    else if (p.startsWith("in the news but not")) add(70, "In the news, but no department has a record of it");
    else if ((m = p.match(/^covered by (\d+) news outlets/)) && Number(m[1]) >= 2) add(50, `Reported by ${m[1]} news outlets`);
    else if ((m = p.match(/^(\d+) citizen complaints/)) && Number(m[1]) >= 3) add(55, `${m[1]} citizens have complained`);
    else if ((m = p.match(/^(\d+) similar incidents here in (\d+) days/)) && Number(m[1]) >= 5) add(40, `Keeps happening: ${m[1]} similar incidents here in ${m[2]} days`);
    else if (/new reports in/.test(p)) add(65, "More reports are still coming in");
  }
  for (const f of flags) {
    if (f.includes("several departments")) add(80, "Needs several departments to act together");
    else if (f.includes("only in the news")) add(70, "In the news, but no department has a record of it");
    else if (f.includes("not verified") && serious) add(75, "No officer has confirmed it on the ground yet");
    else if (f.includes("spreading")) add(65, "More reports are still coming in");
    else if (f.includes("deadline") && !why.some(([, x]) => /deadline/.test(x))) add(60, "Past its deadline");
  }
  if (Number(r.breached ?? r.sla_breached) && !why.some(([, x]) => /deadline/.test(x))) add(60, "Past its deadline");
  why.sort((a, b) => b[0] - a[0]);
  const open = Number(r.open ?? 1) === 1;
  const needsYou = open && why.length > 0 && (serious || why[0][0] >= 70);
  const attention = needsYou ? why.slice(0, 3).map(([, s]) => s) : [];
  const shortFacts = facts.slice(0, 4);
  return { summary, facts: shortFacts, attention, needsYou, what: [summary, ...shortFacts], why: attention };
}

// ------------------------------------------------ news complaints routing --

/** Civic-service categories: a news report about one of these is a complaint for a department. */
export const NEWS_COMPLAINT_CATS = [
  "STREETLIGHT_ELECTRICAL", "WATER_SUPPLY", "DRAINAGE_SEWAGE", "SOLID_WASTE", "STRAY_ANIMALS", "ROAD_DAMAGE",
  "SANITATION_TOILETS", "TREES_PARKS", "ENCROACHMENT", "DARK_SPOT_SAFETY", "PUBLIC_WORKS", "DRAIN_WORKS_SAFETY"
];
const ROUTED = `EXISTS (SELECT 1 FROM ${ops("dept_assignments")} da WHERE da.incident_id = i.incident_id)`;
const AUTO = "District IQ news monitor";
let lastRoute = 0;

/**
 * Is a news report a citizen complaint (a service failure people are living with),
 * rather than an announcement, a plan, a scheduled shutdown or an achievement?
 * The classifier's report_type is too loose on its own ("incident" covers plans),
 * so the headline must also describe a problem.
 */
const PROBLEM = new RegExp([
  "shortage", "no water", "without water", "overflow", "stagnat", "waterlog", "inundat", "flooded", "clogged", "choked", "blocked drain",
  "garbage (pile|dump|heap|mount|strewn|not cleared)", "dumped", "stench", "foul smell", "pothole", "damaged", "broken", "caved?[- ]in",
  "collapsed", "dark stretch", "not working", "non[- ]functional", "unlit", "defunct", "contaminat", "sewage (mix|in|overflow|flow)",
  "leak", "menace", "hassle", "residents (complain|suffer|stage|protest|fume|struggle|demand)", "road blockade", "at risk", "hazard",
  "power cuts?(?! ?:)", "outage", "bribe", "lack of", "unattended", "neglect",
  "புகார்", "அவதி", "மறியல்", "தேங்கி", "சேதம்", "பள்ளம்", "துர்நாற்றம்", "தட்டுப்பாடு"
].join("|"), "i");
const NOT_COMPLAINT = new RegExp([
  "\\bplans?\\b", "to be (built|laid|completed|set up)", "\\bwill\\b", "inaugurat", "launch", "vaccinat", "\\bdrive\\b", "survey",
  "\\borders?\\b", "proposal", "tender", "scheme", "awareness", "schedule", "power cut ?:", "cleared of", "removed", "\\bfined?\\b",
  "cost owners", "arrested", "sensor", "monetis", "biogas", "நாளை", "எந்தெந்த", "அகற்றம்", "பொருத்தம்"
].join("|"), "i");
export function isNewsComplaint(title: string, reportType: string | null): boolean {
  if (["announcement", "service_notice", "business", "politics", "court", "entertainment_sport", "crime"].includes(String(reportType))) return false;
  if (NOT_COMPLAINT.test(title)) return false;
  return reportType === "civic_complaint" || PROBLEM.test(title);
}

/**
 * News reports that are really civic complaints (no department has a record of
 * them yet) go to the department's officer instead of the incident feed. Runs at
 * most once a minute. Automatic assignments that no longer pass the test are
 * withdrawn; anything an officer has acknowledged is left alone.
 */
async function routeNewsComplaints(now: string) {
  if (Date.now() - lastRoute < 60_000) return;
  lastRoute = Date.now();
  try {
    const cands = await q(
      `SELECT i.incident_id AS id, i.lead_dept AS dept, i.category_label AS type, i.zone_name,
              GROUP_CONCAT(CONCAT(COALESCE(d.report_type, ''), '|', d.title) SEPARATOR '\n') AS docs
       FROM incidents i JOIN documents d ON d.linked_incident_id = i.incident_id
       WHERE i.is_open = 1 AND i.media_only = 1 AND i.category_code IN (?) AND i.first_reported_at > (? - INTERVAL 30 DAY)
       GROUP BY i.incident_id, i.lead_dept, i.category_label, i.zone_name`,
      [NEWS_COMPLAINT_CATS, now]
    );
    const rows = cands.filter((r) => String(r.docs ?? "").split("\n").some((line) => {
      const [rt, ...t] = line.split("|");
      return isNewsComplaint(t.join("|"), rt || null);
    }));
    const keep = new Set(rows.map((r) => r.id));
    const auto = await q(`SELECT incident_id FROM ${ops("dept_assignments")} WHERE assigned_by = ? AND status = 'Assigned'`, [AUTO]);
    const drop = auto.map((a) => a.incident_id).filter((id) => !keep.has(id));
    if (drop.length) await q(`DELETE FROM ${ops("dept_assignments")} WHERE assigned_by = ? AND status = 'Assigned' AND incident_id IN (?)`, [AUTO, drop]);
    if (!rows.length) return;
    const contacts = await q(
      `SELECT dept_code, contact_id, name, designation, phone FROM (
         SELECT c.*, ROW_NUMBER() OVER (PARTITION BY dept_code ORDER BY \`rank\`, contact_id) rn
         FROM ${ops("official_contacts")} c WHERE dept_code IS NOT NULL) x WHERE rn = 1`
    );
    const heads = await q(`SELECT code, head FROM ref_departments`);
    const byDept = new Map(contacts.map((c) => [c.dept_code, c]));
    const headOf = new Map(heads.map((h) => [h.code, h.head]));
    for (const r of rows) {
      const c = byDept.get(r.dept);
      await q(
        `INSERT IGNORE INTO ${ops("dept_assignments")}
           (incident_id, dept_code, contact_id, officer_name, officer_designation, officer_phone, reason, assigned_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.dept, c?.contact_id ?? null, c?.name ?? null, c?.designation ?? headOf.get(r.dept) ?? null, c?.phone ?? null,
          `News report of ${String(r.type).toLowerCase()}${r.zone_name ? ` in ${r.zone_name}` : ""} with no department record`, AUTO]
      );
    }
  } catch (err) {
    // The ops tables come from scripts/seed-official-contacts.js; the console still works without them.
    console.warn("news routing skipped:", (err as Error).message);
  }
}

async function assignmentsFor(ids: string[]): Promise<Record<string, Row>> {
  if (!ids.length) return {};
  try {
    const r = await q(
      `SELECT incident_id, dept_code, officer_name, officer_designation, officer_phone, status,
              DATE_FORMAT(assigned_at, '%Y-%m-%d %H:%i:%s') AS assigned_at
       FROM ${ops("dept_assignments")} WHERE incident_id IN (?)`,
      [ids]
    );
    return Object.fromEntries(r.map((a) => [a.incident_id, a]));
  } catch {
    return {};
  }
}

/** Officials published on the GCC website for a department (and the zone's zonal officer). */
export async function contactsFor(dept: string | null, zone: number | null): Promise<Row[]> {
  try {
    return await q(
      `SELECT contact_id, grp, dept_code, zone_no, name, designation, office, phone, email, source_url,
              DATE_FORMAT(retrieved_on, '%Y-%m-%d') AS retrieved_on
       FROM ${ops("official_contacts")}
       WHERE (dept_code = ?) OR (zone_no = ?) ORDER BY zone_no IS NOT NULL, \`rank\`, contact_id`,
      [dept ?? "__none__", zone ?? -1]
    );
  } catch {
    return [];
  }
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

async function kpiBlock(s: Scope, now: string) {
  const p = PERIODS[s.period];
  const cur = scopeWhere(s, now);
  const prev = scopeWhere({ ...s, offset: 1 }, now);
  const cols = `SUM(i.severity_level = 'Severe') AS severe, SUM(CASE WHEN i.is_open = 1 THEN i.citizen_complaints ELSE 0 END) AS complaints,
    SUM(i.is_open) AS ongoing, SUM(i.is_open = 0 AND i.status_std = 'Resolved') AS resolved`;
  const bucketSecs = (p.hours * 3600) / p.buckets;
  const since = periodSince(s.period, now); // daily: buckets of 2 hours from midnight
  const [c, pv, series] = await Promise.all([
    q(`SELECT ${cols} FROM incidents i WHERE ${cur.sql}`, cur.params),
    q(`SELECT ${cols} FROM incidents i WHERE ${prev.sql}`, prev.params),
    q(
      `SELECT FLOOR(TIMESTAMPDIFF(SECOND, ?, i.first_reported_at) / ?) AS b, ${cols}
       FROM incidents i WHERE ${cur.sql} GROUP BY b`,
      [since, bucketSecs, ...cur.params]
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

/**
 * `route: false` skips routing news complaints to departments (a write to the ops tables),
 * for read-only callers such as the assistant; the console, open behind it, routes them.
 */
export async function overview(period: Period, zone: number | null, dept: string | null = null, focus: Focus = {},
  opts: { route?: boolean } = {}) {
  const now = await asOf();
  if (opts.route !== false) await routeNewsComplaints(now);
  const cat = focus.cat ?? null, taluk = focus.taluk ?? null;
  const s: Scope = { period, zone, dept, cat, taluk };
  const w = scopeWhere(s, now);
  const p = PERIODS[period];
  // Zone shading and the zone table follow the department filter but cover every zone.
  const all = scopeWhere({ period, zone: null, dept, cat, taluk }, now);
  // The department list follows zone and period, never the department filter itself.
  const nd = scopeWhere({ period, zone, cat, taluk }, now);
  // My Tasks: citizen complaints where the department officer reported the work done
  // and asked for verification, with no Collector decision yet, and that meet the
  // Collector's criteria (FOR_COLLECTOR); the others are counted as left to departments.
  // Completion reports sent from the officer console always come to My Tasks until the Collector decides.
  const tw = periodWindow(period, now, "i.last_update_at");
  const sent = await sentByOfficer();
  const inScope = `${zone ? "AND i.zone_no = ?" : ""} ${dept ? "AND i.lead_dept = ?" : ""} ${cat ? "AND i.category_code = ?" : ""}
    ${taluk ? "AND i.taluk_code = ?" : ""}`;
  const scopeParams = [...(zone ? [zone] : []), ...(dept ? [dept] : []), ...(cat ? [cat] : []), ...(taluk ? [taluk] : [])];
  const awaitCore = `${tw.sql} AND i.is_open = 1 AND i.awaiting_collector = 1 AND i.citizen_complaints > 0
    AND NOT ${DECIDED("'verify','reject','resolve','reopen'")}`;
  const qWhere = `1 = 1 ${inScope} AND ((${awaitCore} AND ${FOR_COLLECTOR}) OR ${sent})`;
  const qParams = [...scopeParams, ...tw.params];
  // Severity-based incidents: open incidents in the period, minus news complaints sent to a department.
  const sevWhere = `${w.sql} AND i.is_open = 1 AND NOT ${ROUTED}`;

  const [kpi, meta, zoneTable, pins, layerCounts, news, tasks, taskCount, sevRows, sevCounts, byDept, byZone,
    feeds, bell, deptNav, snap, backlog, env, stories, sevAll, added] = await Promise.all([
    kpiBlock(s, now),
    exportMeta(),
    // Every zone, even with no incidents in this scope (the zone picker lists them all).
    q(
      `SELECT z.zone_no AS zone, z.zone_name AS name, COUNT(i.incident_id) AS n, COALESCE(SUM(i.is_open), 0) AS open,
              COALESCE(SUM(CASE WHEN i.is_open = 1 THEN i.citizen_complaints ELSE 0 END), 0) AS complaints,
              COALESCE(SUM(i.severity_level = 'Severe'), 0) AS severe
       FROM (SELECT DISTINCT zone_no, zone_name FROM ref_wards) z
       LEFT JOIN incidents i ON i.zone_no = z.zone_no AND ${all.sql}
       GROUP BY z.zone_no, z.zone_name ORDER BY z.zone_no`,
      all.params
    ),
    q(
      `SELECT i.incident_id AS id, i.lat, i.lon, i.severity_level AS sev, i.is_open AS open, i.citizen_complaints AS complaints,
              i.title, i.status_std AS status, DATE_FORMAT(i.first_reported_at, '%Y-%m-%d %H:%i:%s') AS t
       FROM incidents i WHERE ${w.sql} AND i.lat IS NOT NULL
       ORDER BY i.is_open DESC, ${SEV_RANK}, i.citizen_complaints DESC, i.first_reported_at DESC LIMIT 150`,
      w.params
    ),
    q(
      `SELECT SUM(i.severity_level = 'Severe') AS severe,
              SUM(i.severity_level <> 'Severe' AND i.citizen_complaints > 0) AS complaint,
              SUM(i.severity_level <> 'Severe' AND i.citizen_complaints = 0) AS other
       FROM incidents i WHERE ${w.sql}`,
      w.params
    ),
    q(`SELECT ${ROW} ${FROM} WHERE ${w.sql} AND i.outlet_count > 0 ORDER BY i.first_reported_at DESC LIMIT 24`, w.params),
    q(`SELECT ${ROW}, ${sent} AS officer_sent ${FROM} WHERE ${qWhere} ORDER BY officer_sent DESC, ${SEV_RANK}, i.last_update_at ASC LIMIT 12`, qParams),
    q(`SELECT COALESCE(SUM((${awaitCore} AND ${FOR_COLLECTOR}) OR ${sent}), 0) AS n,
              COALESCE(SUM(${awaitCore} AND NOT ${FOR_COLLECTOR} AND NOT ${sent}), 0) AS left_to_depts
       FROM incidents i WHERE 1 = 1 ${inScope}`, [...tw.params, ...tw.params, ...scopeParams]),
    q(
      `SELECT * FROM (SELECT ${ROW}, ROW_NUMBER() OVER (PARTITION BY i.severity_level
         ORDER BY i.priority_score DESC, i.first_reported_at DESC) AS rn ${FROM} WHERE ${sevWhere}) x
       WHERE rn <= 12 ORDER BY FIELD(sev, 'Severe', 'High', 'Medium', 'Low'), rn`,
      w.params
    ),
    q(`SELECT i.severity_level AS sev, COUNT(*) AS n FROM incidents i WHERE ${sevWhere} GROUP BY i.severity_level`, w.params),
    dept
      ? q(
          `SELECT i.category_label AS l, COUNT(*) AS v FROM incidents i WHERE ${w.sql}
           GROUP BY i.category_label ORDER BY v DESC`,
          w.params
        )
      : q(
          `SELECT i.lead_dept AS code, dp.name AS l, SUM(i.citizen_complaints) AS v ${FROM} WHERE ${w.sql}
           GROUP BY i.lead_dept, dp.name HAVING v > 0 ORDER BY v DESC`,
          w.params
        ),
    zone
      ? q(
          `SELECT i.place_text AS l, COUNT(*) AS n, SUM(i.citizen_complaints) AS v FROM incidents i WHERE ${w.sql} AND i.is_open = 1
           AND i.place_text IS NOT NULL GROUP BY i.place_text ORDER BY v DESC, n DESC LIMIT 5`,
          w.params
        )
      : q(
          `SELECT i.zone_no AS zone, i.zone_name AS l, COUNT(*) AS n, SUM(i.citizen_complaints) AS v FROM incidents i WHERE ${w.sql}
           AND i.is_open = 1 AND i.zone_no IS NOT NULL GROUP BY i.zone_no, i.zone_name ORDER BY v DESC, n DESC LIMIT 5`,
          w.params
        ),
    q(
      `SELECT source, kind, status, minutes_since_success, \`rows\` AS row_count,
              DATE_FORMAT(newest_record_at, '%Y-%m-%d %H:%i:%s') AS newest
       FROM source_health ORDER BY FIELD(source, 'grievance', 'police', 'pwd', 'hospital', 'news', 'imd', 'cpcb', 'cfm')`
    ),
    q(
      `SELECT ${ROW} ${FROM} WHERE i.is_open = 1 AND i.severity_level IN ('Severe', 'High') AND NOT ${ROUTED}
       AND ${periodWindow(period, now).sql} ORDER BY ${SEV_RANK}, i.citizen_complaints DESC LIMIT 6`,
      periodWindow(period, now).params
    ),
    q(
      `SELECT i.lead_dept AS code, dp.name, dp.head, SUM(i.is_open) AS open, COUNT(*) AS n,
              SUM(i.severity_level = 'Severe') AS severe,
              SUM(i.is_open = 1 AND i.awaiting_collector = 1) AS unverified
       ${FROM} WHERE ${nd.sql} GROUP BY i.lead_dept, dp.name, dp.head ORDER BY open DESC, n DESC`,
      nd.params
    ),
    dept ? deptSnapshot(dept, s, now) : zone ? areaSnapshot(zone, s, now) : districtSnapshot(s, now),
    q(
      `SELECT i.lead_dept AS code, dp.name, AVG(i.hours_open) AS h, COUNT(*) AS n ${FROM}
       WHERE i.is_open = 1 ${zone ? "AND i.zone_no = ?" : ""} GROUP BY i.lead_dept, dp.name HAVING n >= 5 ORDER BY h DESC LIMIT 1`,
      zone ? [zone] : []
    ),
    environment(period, now),
    threads({ hours: p.hours, zone, dept, cat, taluk, since: periodSince(period, now) }, now),
    // Severity mix of everything reported in the period (open and closed), for page 2.
    q(`SELECT i.severity_level AS sev, COUNT(*) AS n, SUM(i.is_open) AS open FROM incidents i WHERE ${w.sql} GROUP BY i.severity_level`, w.params),
    // Items from sources the Collector added: at least the last 7 days, so a quiet day still shows them.
    addedItems({ now, days: Math.max(1, Math.round(p.hours / 24)), since: periodSince(period, now), zone, dept, cat, taluk })
  ]);

  const [taskRows, newsRows, sevList, bellRows] = await Promise.all([
    withDecisions(tasks).then(withSources),
    withDecisions(news).then(withSources),
    withDecisions(sevRows).then(withSources),
    withDecisions(bell).then(withSources)
  ]);
  const [actionsTaken, reportsSent, assigned] = await Promise.all([
    officerActions(taskRows.map((r) => r.id)),
    officerReports(taskRows.filter((r) => Number(r.officer_sent)).map((r) => r.id)),
    assignmentsFor(newsRows.map((r) => r.id))
  ]);
  const num = (rows: Row[]) => Object.fromEntries(SEV_LEVELS.map((k) => [k, Number(rows.find((r) => r.sev === k)?.n ?? 0)]));

  return {
    now,
    period,
    zone,
    dept,
    cat,
    taluk,
    exportedAt: meta.exported_at ?? null,
    /** did today's 6:00 AM collection run, and which feeds are still missing */
    collection: collectionStatus(),
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
    news: newsRows.map((r) => ({ ...r, outletNames: r.src?.outlets ?? [], assigned: assigned[r.id] ?? null }) as Row),
    tasks: {
      rows: taskRows.map((r) => ({ ...r, action: reportsSent[r.id] ?? actionsTaken[r.id] ?? null, because: taskBecause(r) }) as Row),
      count: Number(taskCount[0]?.n ?? 0),
      leftToDepts: Number(taskCount[0]?.left_to_depts ?? 0)
    },
    severity: {
      counts: num(sevCounts) as Record<string, number>,
      rows: sevList.map((r) => ({ ...r, why: explain(r) }) as Row)
    },
    severityMix: SEV_LEVELS.map((k) => {
      const r = sevAll.find((x) => x.sev === k);
      return { sev: k, n: Number(r?.n ?? 0), open: Number(r?.open ?? 0) };
    }),
    stories,
    added,
    bottom: {
      /** by department (no department filter) or by category (a department is selected) */
      byDept: byDept.map((r) => ({ code: (r.code as string | undefined) ?? null, l: String(r.l ?? r.code ?? "Other"), v: Number(r.v) })),
      byZone: byZone.map((r) => ({ zone: r.zone ?? null, l: r.l, v: Number(r.v), n: Number(r.n) })),
      ...env
    },
    feeds,
    bell: bellRows,
    deptNav: deptNav.map((d) => ({ code: d.code, name: d.name ?? d.code, head: d.head, open: Number(d.open), n: Number(d.n),
      severe: Number(d.severe), unverified: Number(d.unverified) })),
    periodInfo: p
  };
}

const SEV_LEVELS = ["Severe", "High", "Medium", "Low"] as const;

/** What the department officer reported when asking for verification: the latest officer step. */
async function officerActions(ids: string[]): Promise<Record<string, Row>> {
  if (!ids.length) return {};
  const r = await q(
    `SELECT id, t, step, note, actor FROM (
       SELECT incident_id AS id, DATE_FORMAT(at, '%Y-%m-%d %H:%i:%s') AS t, step, note, actor,
              ROW_NUMBER() OVER (PARTITION BY incident_id ORDER BY at DESC) rn
       FROM incident_timeline WHERE incident_id IN (?) AND step IN ('Awaiting verification', 'Work in progress', 'Resolved')) x
     WHERE rn = 1`,
    [ids]
  );
  return Object.fromEntries(r.map((x) => [x.id, x]));
}

/**
 * Numbers every snapshot shows, none of which repeat the KPI tiles above it: open severe or
 * high incidents, open incidents past their deadline, and open incidents seen only in the news
 * (no department has a record of them), all for incidents reported in the period and scope.
 */
async function snapCommon(s: Scope, now: string) {
  const w = scopeWhere(s, now);
  const [r] = await q(
    `SELECT COALESCE(SUM(i.is_open = 1 AND i.severity_level IN ('Severe', 'High')), 0) AS serious,
            COALESCE(SUM(i.is_open = 1 AND i.sla_breached = 1), 0) AS overdue,
            COALESCE(SUM(i.is_open = 1 AND i.media_only = 1), 0) AS news_only
     FROM incidents i WHERE ${w.sql}`,
    w.params
  );
  return { serious: Number(r?.serious ?? 0), overdue: Number(r?.overdue ?? 0), newsOnly: Number(r?.news_only ?? 0) };
}

/** Snapshot card when a department is selected: who runs it and where its load sits. */
async function deptSnapshot(code: string, s: Scope, now: string) {
  const w = scopeWhere(s, now);
  const [info, k, topZone, contacts, common] = await Promise.all([
    q(`SELECT code, name, org, head, route FROM ref_departments WHERE code = ?`, [code]),
    q(
      `SELECT SUM(i.is_open) AS open, SUM(i.is_open = 1 AND i.verified = 1) AS verified,
              SUM(i.severity_level = 'Severe') AS severe, SUM(i.sla_breached = 1 AND i.is_open = 1) AS overdue
       FROM incidents i WHERE ${w.sql}`,
      w.params
    ),
    q(
      // same period and scope as the rest of the snapshot
      `SELECT i.zone_no AS zone, i.zone_name AS name, COUNT(*) AS n FROM incidents i
       WHERE ${w.sql} AND i.is_open = 1 AND i.zone_no IS NOT NULL
       GROUP BY i.zone_no, i.zone_name ORDER BY n DESC LIMIT 1`,
      w.params
    ),
    contactsFor(code, s.zone),
    snapCommon(s, now)
  ]);
  return {
    kind: "dept" as const,
    ...common,
    dept: info[0] ?? { code, name: code, org: "", head: "", route: "" },
    open: Number(k[0]?.open ?? 0),
    verified: Number(k[0]?.verified ?? 0),
    severe: Number(k[0]?.severe ?? 0),
    overdue: Number(k[0]?.overdue ?? 0),
    topZone: topZone[0] ?? null,
    contacts
  };
}

/**
 * Rain gauges, air-quality stations and lakes, each with its location, so the
 * console can show readings for the selected zone (or the nearest station).
 */
async function environment(period: Period, now: string) {
  const days = Math.max(7, Math.round(PERIODS[period].hours / 24));
  const [rainDays, rain, aqi, lakes] = await Promise.all([
    q(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, rain_intensity AS v, rain_event AS ev FROM world_calendar
       WHERE date > DATE(?) - INTERVAL ? DAY AND date <= DATE(?) ORDER BY date`,
      [now, days * 2, now]
    ),
    q(
      `SELECT place_id AS id, place_name AS name, zone_no AS zone, lat, lon,
              DATE_FORMAT(observed_at, '%Y-%m-%d %H:%i:%s') AS t, value AS v
       FROM observations WHERE metric = 'rainfall_24h_mm' ORDER BY observed_at`
    ),
    q(
      `SELECT place_id AS id, place_name AS name, zone_no AS zone, lat, lon,
              DATE_FORMAT(observed_at, '%Y-%m-%d %H:%i:%s') AS t, value AS v
       FROM observations WHERE metric = 'aqi' AND observed_at > ? - INTERVAL 7 DAY ORDER BY observed_at`,
      [now]
    ),
    q(
      `SELECT place_id AS id, place_name AS name, zone_no AS zone, lat, lon,
              DATE_FORMAT(observed_at, '%Y-%m-%d') AS t, value AS v
       FROM observations WHERE metric = 'lake_pct_full' AND observed_at > ? - INTERVAL ? DAY ORDER BY observed_at`,
      [now, days]
    )
  ]);
  const group = (rows: Row[]) => {
    const m = new Map<string, Row>();
    for (const r of rows) {
      const st = m.get(r.id) ?? { id: r.id, name: r.name, zone: r.zone ?? null, lat: Number(r.lat), lon: Number(r.lon), times: [], series: [] };
      st.times.push(r.t);
      st.series.push(Math.round(Number(r.v) * 10) / 10);
      m.set(r.id, st);
    }
    return [...m.values()] as Station[];
  };
  const cur = rainDays.slice(-days);
  const prev = rainDays.slice(0, Math.max(0, rainDays.length - days));
  return {
    rain: {
      stations: group(rain),
      days: cur.map((r) => r.d),
      intensity: cur.map((r) => Number(r.v)),
      rainDays: cur.filter((r) => Number(r.ev)).length,
      prevRainDays: prev.filter((r) => Number(r.ev)).length
    },
    aqi: { stations: group(aqi) },
    lakes: { stations: group(lakes) }
  };
}

export interface Station { id: string; name: string; zone: number | null; lat: number; lon: number; times: string[]; series: number[] }

async function districtSnapshot(s: Scope, now: string) {
  const w = scopeWhere(s, now);
  const [top, depts, crit, zones, common, taluk] = await Promise.all([
    q(
      `SELECT i.zone_no AS zone, i.zone_name AS name,
              SUM(CASE i.severity_level WHEN 'Severe' THEN 3 WHEN 'High' THEN 1 ELSE 0 END) AS score
       FROM incidents i WHERE ${w.sql} AND i.zone_no IS NOT NULL GROUP BY i.zone_no, i.zone_name
       HAVING score > 0 ORDER BY score DESC, SUM(i.severity_level = 'Severe') DESC LIMIT 2`,
      w.params
    ),
    q(`SELECT COUNT(DISTINCT i.lead_dept) AS n FROM incidents i WHERE ${w.sql} AND i.is_open = 1`, w.params),
    q(
      `SELECT COUNT(*) AS n FROM incidents i WHERE i.is_open = 1 AND i.severity_level = 'Severe'
       AND (i.verified = 0 OR i.awaiting_collector = 1) AND NOT ${DECIDED("'verify','reject','resolve'")}`
    ),
    q(`SELECT COUNT(DISTINCT zone_no) AS n FROM ref_wards`),
    snapCommon(s, now),
    // the taluk with the most open incidents among those reported in the period
    q(`SELECT t.name, COUNT(*) AS n FROM incidents i JOIN ref_taluks t ON t.taluk_code = i.taluk_code
       WHERE ${w.sql} AND i.is_open = 1 GROUP BY t.name ORDER BY n DESC LIMIT 1`, w.params)
  ]);
  return {
    kind: "district" as const,
    ...common,
    topTaluk: taluk[0] ? { name: String(taluk[0].name), n: Number(taluk[0].n) } : null,
    zones: Number(zones[0]?.n ?? 0),
    topZones: top.map((t) => ({ zone: t.zone, name: t.name })),
    activeDepts: Number(depts[0]?.n ?? 0),
    critical: Number(crit[0]?.n ?? 0)
  };
}

async function areaSnapshot(zone: number, s: Scope, now: string) {
  const w = scopeWhere(s, now);
  const [k, keyDept, latest, zoneOfficer, common] = await Promise.all([
    q(
      `SELECT SUM(i.is_open) AS active, SUM(CASE WHEN i.is_open = 1 THEN i.citizen_complaints ELSE 0 END) AS complaints,
              SUM(i.severity_level = 'Severe') AS severe FROM incidents i WHERE ${w.sql}`,
      w.params
    ),
    q(
      `SELECT i.lead_dept AS code, dp.name, dp.head, COUNT(*) AS n ${FROM}
       WHERE ${w.sql} AND i.is_open = 1 GROUP BY i.lead_dept, dp.name, dp.head ORDER BY n DESC LIMIT 1`,
      w.params
    ),
    q(
      `SELECT DATE_FORMAT(t.at, '%Y-%m-%d %H:%i:%s') AS at, t.step, t.note, i.title
       FROM incident_timeline t JOIN incidents i ON i.incident_id = t.incident_id
       WHERE i.zone_no = ? AND i.is_open = 1 AND t.at <= ? ORDER BY t.at DESC LIMIT 1`,
      [zone, now]
    ),
    contactsFor(null, zone),
    snapCommon(s, now)
  ]);
  return {
    kind: "area" as const,
    ...common,
    active: Number(k[0]?.active ?? 0),
    complaints: Number(k[0]?.complaints ?? 0),
    severe: Number(k[0]?.severe ?? 0),
    keyDept: keyDept[0] ?? null,
    latest: latest[0] ?? null,
    zoneOfficer: zoneOfficer[0] ?? null
  };
}

// ------------------------------------------------------------- incident --

const SOURCE_WORD: Record<string, string> = {
  grievance: "Citizen complaint", police: "Police report", pwd: "PWD field record", hospital: "Hospital report",
  news: "News report", imd: "IMD warning"
};

/**
 * One incident for the Collector's read-only view: the facts, plain-language
 * reasons, and every report the dedup step merged into it, each at its own time.
 */
export async function incident(id: string) {
  const [inc] = await q(
    `SELECT ${ROW}, DATE_FORMAT(i.closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at,
            DATE_FORMAT(i.sla_due_at, '%Y-%m-%d %H:%i:%s') AS sla_due, i.depts_involved, i.dead, i.injured,
            i.persons_affected, i.vulnerable, dp.head AS dept_head, dp.org AS dept_org, i.confidence, i.needs_review, i.review_reason,
            i.taluk_code, tk.name AS taluk_name, i.spread_m
     ${FROM} LEFT JOIN ref_taluks tk ON tk.taluk_code = i.taluk_code WHERE i.incident_id = ?`,
    [id]
  );
  if (!inc) return null;

  const [members, documents, decisions, contacts, assigned, src, deptReports] = await Promise.all([
    q(
      `SELECT m.event_id, m.source, m.channel, DATE_FORMAT(m.reported_at, '%Y-%m-%d %H:%i:%s') AS t, m.title, m.role,
              m.link_prob, m.link_method, LEFT(e.text, 280) AS text
       FROM incident_members m LEFT JOIN events e ON e.event_id = m.event_id
       WHERE m.incident_id = ? ORDER BY m.reported_at LIMIT 80`,
      [id]
    ),
    q(
      // the linked articles plus the rest of their news story (the same event covered by other outlets)
      `SELECT doc_id, event_id, title, publisher, url, lang, DATE_FORMAT(published_at, '%Y-%m-%d %H:%i:%s') AS t
       FROM documents WHERE linked_incident_id = ?
          OR story_id IN (SELECT story_id FROM (SELECT story_id FROM documents WHERE linked_incident_id = ? AND story_id IS NOT NULL) s)
       ORDER BY published_at LIMIT 40`,
      [id, id]
    ),
    q(
      `SELECT decision, note, decided_by, DATE_FORMAT(decided_at, '%Y-%m-%d %H:%i:%s') AS t
       FROM ${ops("collector_decisions")} WHERE incident_id = ? ORDER BY decision_id`,
      [id]
    ),
    contactsFor(inc.dept, inc.zone),
    assignmentsFor([id]),
    sourcesFor([id]),
    officerReportsFull(id)
  ]);

  // Linked reports in time order; news articles linked without a member row are added too.
  const seen = new Set(members.map((m) => m.event_id));
  const docOf = new Map(documents.filter((d) => d.event_id).map((d) => [d.event_id, d]));
  const reports = [
    ...members.map((m) => {
      const d = docOf.get(m.event_id);
      return {
        t: m.t, source: m.source, what: SOURCE_WORD[m.source] ?? m.source, channel: m.channel,
        title: d?.title ?? m.title, text: m.source === "news" ? null : m.text, publisher: d?.publisher ?? null, url: d?.url ?? null,
        lang: d?.lang ?? null, first: m.role === "first_report",
        link: m.role === "first_report" ? null : m.link_prob == null ? null : Number(m.link_prob), method: m.link_method ?? null
      };
    }),
    ...documents.filter((d) => !d.event_id || !seen.has(d.event_id)).map((d) => ({
      t: d.t, source: "news", what: "News report", channel: "media", title: d.title, text: null, publisher: d.publisher,
      url: d.url, lang: d.lang, first: false
    }))
  ].sort((a, b) => String(a.t).localeCompare(String(b.t)));

  const last = decisions.filter((d) => d.decision !== "note").slice(-1)[0];
  const row: Row = { ...overlay(inc, last ? { ...last, decided_at: last.t } : undefined), src: src[id] ?? null };
  return {
    incident: { ...row, why: explain(row) } as Row,
    reports,
    contacts,
    assigned: assigned[id] ?? null,
    decisions,
    /** completion reports from the department's officer console (remarks and site photos), newest first */
    deptReports
  };
}


// ------------------------------------------------------------ list modal --

export interface ListFilter {
  period: Period;
  zone: number | null;
  dept: string | null;
  sev: string | null;
  cat?: string | null;
  taluk?: string | null;
  status: string | null;
  q: string | null;
  sort: "t" | "sev" | "c" | "r" | "d";
  dir: 1 | -1;
  page: number;
  /** period = the dashboard's period; 30d = reported in the last 30 days; all = any date */
  scope: "period" | "all" | "30d";
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
    if (f.scope === "30d") (where.push("i.first_reported_at > ? - INTERVAL 30 DAY"), params.push(now));
    if (f.zone) (where.push("i.zone_no = ?"), params.push(f.zone));
    if (f.dept) (where.push("i.lead_dept = ?"), params.push(f.dept));
  }
  if (f.sev) (where.push("i.severity_level = ?"), params.push(f.sev));
  if (f.cat) (where.push("i.category_code = ?"), params.push(f.cat));
  if (f.taluk) (where.push("i.taluk_code = ?"), params.push(f.taluk));
  const st = f.status;
  // "open" matches the severity tile: news complaints handed to a department are not listed as incidents.
  if (st === "open") where.push(`i.is_open = 1 AND NOT ${ROUTED}`);
  else if (st === "unverified") where.push(`i.is_open = 1 AND i.verified = 0 AND NOT ${DECIDED("'verify','reject','resolve'")}`);
  else if (st === "verified") where.push("i.is_open = 1 AND i.verified = 1");
  else if (st === "overdue") where.push(`i.is_open = 1 AND i.sla_breached = 1 AND NOT ${ROUTED}`);
  else if (st === "awaiting")
    where.push(`((i.is_open = 1 AND i.awaiting_collector = 1 AND i.citizen_complaints > 0 AND ${FOR_COLLECTOR} AND NOT ${DECIDED("'verify','reject','resolve','reopen'")})
      OR ${await sentByOfficer()})`);
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
  return { rows: await withDecisions(rows).then(withSources), total: Number(tot[0].n), complaints: Number(tot[0].c) };
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

/**
 * CSV export: the Collector's action list, not every incident. Two short sections: open
 * incidents that need the Collector (the same explain() rule as the dashboard), then closed
 * work waiting for the Collector's check (the My Tasks rule). Routine incidents stay with
 * the departments and are only counted in the PDF.
 */
export async function exportRows(period: Period, zone: number | null, dept: string | null, focus: Focus = {}) {
  const now = await asOf();
  const w = scopeWhere({ period, zone, dept, ...focus }, now);
  const extra: string[] = [], xp: unknown[] = [];
  if (zone) { extra.push("i.zone_no = ?"); xp.push(zone); }
  if (dept) { extra.push("i.lead_dept = ?"); xp.push(dept); }
  if (focus.cat) { extra.push("i.category_code = ?"); xp.push(focus.cat); }
  if (focus.taluk) { extra.push("i.taluk_code = ?"); xp.push(focus.taluk); }
  const sent = await sentByOfficer();
  const [open, checks] = await Promise.all([
    q(`SELECT ${ROW} ${FROM} WHERE ${w.sql} AND i.is_open = 1 AND NOT ${ROUTED} ORDER BY i.priority_score DESC LIMIT 400`, w.params),
    q(`SELECT ${ROW}, ${sent} AS officer_sent ${FROM} WHERE ((i.is_open = 1 AND i.awaiting_collector = 1 AND i.citizen_complaints > 0 AND ${FOR_COLLECTOR}
         AND NOT ${DECIDED("'verify','reject','resolve','reopen'")}) OR ${sent}) ${extra.map((x) => `AND ${x}`).join(" ")}
       ORDER BY ${SEV_RANK}, i.last_update_at ASC LIMIT 100`, xp)
  ]);
  const need = open.map((r) => ({ r, p: explain(r) })).filter((x) => x.p.needsYou);
  const row = (list: string, r: Row, why: string) => ({
    list, id: r.id, what: r.title || r.type, where: [r.ward ? `Ward ${r.ward}` : null, r.zone_name].filter(Boolean).join(", ") || "Chennai",
    department: r.dept_name ?? r.dept, severity: r.sev, why, reported: String(r.t).slice(0, 16),
    past_deadline: Number(r.breached) ? "Yes" : "No", complaints: r.complaints
  });
  return [
    ...need.map(({ r, p }) => row("Needs your attention", r, p.attention.join("; "))),
    ...checks.map((r) => row("Closed work to check", r, taskBecause(r).join("; ")))
  ];
}

// ---------------------------------------------------------- departments --

/** Departments that own incidents, for the department picker and sidebar. */
export async function deptList() {
  return q<{ code: string; name: string; head: string | null }>(
    `SELECT d.code, d.name, d.head FROM ref_departments d
     WHERE d.action_owner = 1 AND EXISTS (SELECT 1 FROM incidents i WHERE i.lead_dept = d.code) ORDER BY d.name`
  );
}

// ---------------------------------------------------------------- report --

/**
 * Everything the PDF report prints: the overview for the scope, plus the open
 * complaints and the ongoing incidents by severity, each with its reasons.
 */
export async function report(period: Period, zone: number | null, dept: string | null, focus: Focus = {}) {
  const ov = await overview(period, zone, dept, focus);
  const now = ov.now;
  const w = scopeWhere({ period, zone, dept, ...focus }, now);
  const [cands, news] = await Promise.all([
    // the incidents that need the Collector: open, highest priority first, kept only if explain() says so
    q(`SELECT ${ROW} ${FROM} WHERE ${w.sql} AND i.is_open = 1 AND NOT ${ROUTED} ORDER BY i.priority_score DESC LIMIT 400`, w.params),
    // in the news, with no department record
    q(`SELECT ${ROW} ${FROM} WHERE ${w.sql} AND i.is_open = 1 AND i.media_only = 1 ORDER BY i.priority_score DESC LIMIT 5`, w.params)
  ]);
  // the report lists the 10 most urgent; the rest are on the dashboard and in the action list (CSV)
  const allNeed = cands.map((r) => ({ ...r, why: explain(r) })).filter((r) => r.why.needsYou);
  const [a, g] = await Promise.all([withSources(allNeed.slice(0, 10)), withSources(news)]);
  return {
    ...ov,
    report: {
      attention: a,
      attentionTotal: allNeed.length,
      routine: Math.max(0, ov.kpi.cur.ongoing - allNeed.length),
      newsOnly: g.map((r) => ({ ...r, why: explain(r) }))
    }
  };
}
