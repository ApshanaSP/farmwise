/**
 * Briefing, follow-ups, trends and patterns for the Collector console's Briefing and
 * Trends pages. Every sentence is built from the store's own numbers and carries the
 * incident IDs behind it, so each claim can be opened and checked.
 */
import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { PERIODS, asOf, explain, periodSince, periodWindow, type Focus, type Period } from "@/lib/collector/intel";
import { categories } from "@/lib/collector/nlp";
import { addedItems, mandi, mandiMarkets, mandiWeekly } from "@/lib/collector/sources";

type Row = Record<string, any>;
async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await intelPool.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}

interface Scope { period: Period; zone: number | null; dept: string | null; cat: string | null; taluk: string | null }

function where(s: Scope, now: string, opts: { hours?: number; offset?: number; noCat?: boolean } = {}) {
  // the period window (daily = today from midnight) unless a fixed number of hours is asked for
  const win = periodWindow(s.period, now, "i.first_reported_at", opts.offset ?? 0, opts.hours);
  const parts = [win.sql];
  const params: unknown[] = [...win.params];
  if (s.zone) (parts.push("i.zone_no = ?"), params.push(s.zone));
  if (s.dept) (parts.push("i.lead_dept = ?"), params.push(s.dept));
  if (s.cat && !opts.noCat) (parts.push("i.category_code = ?"), params.push(s.cat));
  if (s.taluk) (parts.push("i.taluk_code = ?"), params.push(s.taluk));
  return { sql: parts.join(" AND "), params };
}

const INC = `i.incident_id AS id, i.title, i.category_label AS type, i.category_code AS cat, i.lead_dept AS dept, dp.name AS dept_name,
  i.zone_no AS zone, i.zone_name, i.ward_no AS ward, i.place_text AS loc, i.severity_level AS sev, i.status_std AS status, i.is_open AS open,
  i.citizen_complaints AS complaints, i.source_count, i.sources, i.member_count, i.priority_score AS priority, i.sla_breached AS breached,
  i.severity_reasons, i.priority_reasons, i.attention_reason, i.outlet_count, i.media_only, i.confidence,
  DATE_FORMAT(i.first_reported_at, '%Y-%m-%d %H:%i:%s') AS t, DATE_FORMAT(i.sla_due_at, '%Y-%m-%d %H:%i:%s') AS due`;
const FROM = `FROM incidents i LEFT JOIN ref_departments dp ON dp.code = i.lead_dept`;

const SOURCE_NAME: Record<string, string> = {
  grievance: "citizen complaints", police: "police records", pwd: "PWD records", news: "the news", hospital: "hospital reports",
  imd: "IMD weather", cpcb: "air-quality stations", cfm: "flood monitoring"
};
const plural = (n: number, w: string, p = w + "s") => `${n.toLocaleString("en-IN")} ${n === 1 ? w : p}`;
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);

/** Monday of the as-of week, as SQL (takes the as-of time twice). */
const MON = "(DATE(?) - INTERVAL WEEKDAY(?) DAY)";

export async function insights(period: Period, zone: number | null, dept: string | null, focus: Focus = {}) {
  const now = await asOf();
  const s: Scope = { period, zone, dept, cat: focus.cat ?? null, taluk: focus.taluk ?? null };
  const w = where(s, now), pw = where(s, now, { offset: 1 });
  const cats = categories();
  const playbook = new Map(cats.map((c) => [c.code, c.playbook]));
  const catLabel = new Map(cats.map((c) => [c.code, c.label]));

  const [k, kp, top, nextActs, deptRows, gaps, weekly, monthly, taluks, anomalies, hotspots, unplaced, unplacedN, review, zoneNames, env, catZones] = await Promise.all([
    q(`SELECT COUNT(*) AS n, SUM(i.severity_level = 'Severe') AS severe, SUM(i.is_open) AS open,
              SUM(i.is_open = 1 AND i.sla_breached = 1) AS overdue, SUM(i.citizen_complaints) AS complaints,
              SUM(i.source_count > 1) AS multi, SUM(i.media_only) AS news_only
       FROM incidents i WHERE ${w.sql}`, w.params),
    q(`SELECT COUNT(*) AS n, SUM(i.severity_level = 'Severe') AS severe FROM incidents i WHERE ${pw.sql}`, pw.params),
    // candidates for "needs your attention": open, highest priority first (explain() decides which need the Collector)
    q(`SELECT ${INC} ${FROM} WHERE ${w.sql} AND i.is_open = 1 ORDER BY i.priority_score DESC LIMIT 30`, w.params),
    // next open action per open incident in scope (pipeline action list, SOP order)
    q(`SELECT a.incident_id AS id, a.dept_code, a.owner, a.text, a.status, DATE_FORMAT(a.due_at, '%Y-%m-%d %H:%i:%s') AS due,
              ROW_NUMBER() OVER (PARTITION BY a.incident_id ORDER BY a.status = 'In progress' DESC, a.due_at, a.action_id) AS rn
       FROM actions a JOIN incidents i ON i.incident_id = a.incident_id
       WHERE ${w.sql} AND i.is_open = 1 AND a.status NOT IN ('Done', 'Verified')`, w.params),
    q(`SELECT i.lead_dept AS code, dp.name, dp.head, COUNT(*) AS open, SUM(i.sla_breached) AS overdue,
              SUM(i.severity_level IN ('Severe', 'High')) AS serious, SUM(i.awaiting_collector) AS awaiting,
              SUM(i.citizen_complaints) AS complaints
       ${FROM} WHERE ${w.sql} AND i.is_open = 1 GROUP BY i.lead_dept, dp.name, dp.head
       ORDER BY serious DESC, overdue DESC, open DESC`, w.params),
    // in the news, no department record
    q(`SELECT ${INC}, g.suggested_action, g.gap_strength FROM incidents i LEFT JOIN ref_departments dp ON dp.code = i.lead_dept
       LEFT JOIN gaps g ON g.incident_id = i.incident_id
       WHERE ${where(s, now).sql} AND i.media_only = 1 AND i.status_std <> 'Lapsed'
       ORDER BY i.priority_score DESC LIMIT 60`, where(s, now).params),
    q(`SELECT i.category_code AS cat, DATE_FORMAT(DATE_SUB(DATE(i.first_reported_at), INTERVAL WEEKDAY(i.first_reported_at) DAY), '%Y-%m-%d') AS b,
              COUNT(*) AS n ${FROM} WHERE ${where(s, now, { hours: 12 * 7 * 24, noCat: true }).sql}
       GROUP BY cat, b`, where(s, now, { hours: 12 * 7 * 24, noCat: true }).params),
    q(`SELECT i.category_code AS cat, DATE_FORMAT(i.first_reported_at, '%Y-%m') AS b, COUNT(*) AS n ${FROM}
       WHERE ${where(s, now, { hours: 180 * 24, noCat: true }).sql} GROUP BY cat, b`, where(s, now, { hours: 180 * 24, noCat: true }).params),
    // unresolved incidents by taluk over the last 30 days, against the 30 days before
    q(`SELECT t.taluk_code AS code, t.name, COALESCE(x.open, 0) AS open, COALESCE(x.severe, 0) AS severe, COALESCE(x.overdue, 0) AS overdue,
              COALESCE(x.reported, 0) AS reported, COALESCE(y.reported, 0) AS prev
       FROM ref_taluks t
       LEFT JOIN (SELECT i.taluk_code, COUNT(*) AS reported, SUM(i.is_open) AS open, SUM(i.is_open = 1 AND i.severity_level = 'Severe') AS severe,
                         SUM(i.is_open = 1 AND i.sla_breached = 1) AS overdue
                  FROM incidents i WHERE ${where({ ...s, taluk: null }, now, { hours: 720 }).sql} GROUP BY i.taluk_code) x ON x.taluk_code = t.taluk_code
       LEFT JOIN (SELECT i.taluk_code, COUNT(*) AS reported FROM incidents i
                  WHERE ${where({ ...s, taluk: null }, now, { hours: 720, offset: 1 }).sql} GROUP BY i.taluk_code) y ON y.taluk_code = t.taluk_code
       WHERE t.in_district = 1 ORDER BY open DESC`,
      [...where({ ...s, taluk: null }, now, { hours: 720 }).params, ...where({ ...s, taluk: null }, now, { hours: 720, offset: 1 }).params]),
    q(`SELECT DATE_FORMAT(a.date, '%Y-%m-%d') AS date, a.category_code AS cat, a.zone_no AS zone, a.observed, a.expected, a.ratio, a.p_value
       FROM anomalies a WHERE a.date > DATE(?) - INTERVAL 21 DAY ${zone ? "AND a.zone_no = ?" : ""} ORDER BY a.date DESC, a.ratio DESC`,
      zone ? [now, zone] : [now]),
    q(`SELECT hotspot_id AS id, category_code AS cat, incidents, incidents_30d, open, lat, lon, wards, top_place,
              DATE_FORMAT(first_seen, '%Y-%m-%d') AS first_seen, DATE_FORMAT(last_seen, '%Y-%m-%d') AS last_seen
       FROM hotspots WHERE incidents_30d >= 3 ORDER BY incidents_30d DESC LIMIT 60`),
    // locations that could not be placed on the district map
    q(`SELECT ${INC} ${FROM} WHERE ${where({ ...s, zone: null }, now, { hours: Math.max(PERIODS[period].hours, 720) }).sql}
       AND i.zone_no IS NULL AND i.is_open = 1 ORDER BY i.priority_score DESC LIMIT 300`,
      where({ ...s, zone: null }, now, { hours: Math.max(PERIODS[period].hours, 720) }).params),
    q(`SELECT COUNT(*) AS n FROM incidents i WHERE ${where({ ...s, zone: null }, now, { hours: Math.max(PERIODS[period].hours, 720) }).sql}
       AND i.zone_no IS NULL AND i.is_open = 1`, where({ ...s, zone: null }, now, { hours: Math.max(PERIODS[period].hours, 720) }).params),
    q(`SELECT item_type, COUNT(*) AS n FROM review_queue WHERE status IN ('open', 'pending', 'new') OR status IS NULL GROUP BY item_type`),
    q(`SELECT DISTINCT zone_no, zone_name, ward_no FROM ref_wards`),
    q(`SELECT metric, ROUND(AVG(value), 1) AS v FROM (
         SELECT o.metric, o.place_id, o.value, ROW_NUMBER() OVER (PARTITION BY o.metric, o.place_id ORDER BY o.observed_at DESC) rn
         FROM observations o WHERE o.metric IN ('rainfall_24h_mm', 'aqi', 'lake_pct_full') AND o.observed_at <= ?) x WHERE rn = 1 GROUP BY metric`, [now]),
    // each category by zone, last 4 weeks against the 4 before: where a rise is coming from
    q(`SELECT i.category_code AS cat, i.zone_no AS zone, SUM(i.first_reported_at >= ${MON} - INTERVAL 28 DAY) AS recent,
              SUM(i.first_reported_at < ${MON} - INTERVAL 28 DAY) AS before_
       FROM incidents i WHERE i.first_reported_at >= ${MON} - INTERVAL 56 DAY AND i.first_reported_at < ${MON} AND i.zone_no IS NOT NULL
       ${zone ? "AND i.zone_no = ?" : ""} ${dept ? "AND i.lead_dept = ?" : ""} ${s.taluk ? "AND i.taluk_code = ?" : ""}
       GROUP BY i.category_code, i.zone_no`, [now, now, now, now, now, now, now, now, ...(zone ? [zone] : []), ...(dept ? [dept] : []), ...(s.taluk ? [s.taluk] : [])])
  ]);

  const zn = new Map<number, string>();
  const wardZone = new Map<number, number>();
  for (const z of zoneNames) { zn.set(Number(z.zone_no), z.zone_name); wardZone.set(Number(z.ward_no), Number(z.zone_no)); }
  const next = new Map(nextActs.filter((a) => Number(a.rn) === 1).map((a) => [a.id, a]));
  const proposed = (i: Row) => {
    const a = next.get(i.id);
    if (a) return { text: a.text, owner: a.owner || i.dept_name, due: a.due, from: "department action list" };
    const pb = playbook.get(i.cat);
    return pb?.length ? { text: pb[0], owner: i.dept_name, due: null, from: "standard procedure for this category" } : null;
  };

  // ---------------------------------------------------------- briefing --
  const K = k[0] ?? {}, P = kp[0] ?? {};
  const n = Number(K.n ?? 0), sev = Number(K.severe ?? 0), open = Number(K.open ?? 0), overdue = Number(K.overdue ?? 0);
  const ch = pct(n, Number(P.n ?? 0));
  const scope = [zone ? zn.get(zone) : null, dept ? deptRows.find((d) => d.code === dept)?.name ?? dept : null, s.cat ? catLabel.get(s.cat) : null,
    s.taluk ? taluks.find((t) => t.code === s.taluk)?.name + " taluk" : null].filter(Boolean).join(", ") || "Chennai district";
  const headline = [
    `${plural(n, "incident")} were reported in ${scope} (${PERIODS[period].label.toLowerCase()})` +
      (ch == null ? "." : `, ${ch === 0 ? "the same as" : `${Math.abs(ch)}% ${ch > 0 ? "more than" : "fewer than"}`} the previous period.`),
    `${plural(open, "incident")} ${open === 1 ? "is" : "are"} still open${overdue ? `, ${overdue} of them past the deadline` : ""}; ${plural(sev, "severe event")}.`,
    Number(K.multi) ? `${plural(Number(K.multi), "incident")} came from more than one source, and ${plural(Number(K.news_only ?? 0), "incident")} ${Number(K.news_only) === 1 ? "appears" : "appear"} only in the news.` : null
  ].filter(Boolean) as string[];

  // only incidents that meet the Collector's attention rules; the department handles the rest
  const attention = top.map((i) => ({ i, why: explain(i) })).filter((x) => x.why.needsYou).slice(0, 6).map(({ i, why }) => ({
    id: i.id, title: i.title || `${i.type} – ${i.loc ?? i.zone_name ?? "Chennai"}`, sev: i.sev, status: i.status, zone: i.zone_name, dept: i.dept_name ?? i.dept,
    why, evidence: `${plural(Number(i.member_count), "report")} from ${String(i.sources).split("|").map((x) => SOURCE_NAME[x] ?? x).join(", ")}`,
    next: proposed(i), overdue: Number(i.breached) === 1, confidence: i.confidence == null ? null : Number(i.confidence)
  }));
  const handledByDepts = Math.max(0, open - attention.length);

  const emerging = anomalies.slice(0, 8).map((a) => ({
    ...a, label: catLabel.get(a.cat) ?? a.cat, zone_name: zn.get(Number(a.zone)) ?? null,
    text: `${catLabel.get(a.cat) ?? a.cat} in ${zn.get(Number(a.zone)) ?? "the district"}: ${a.observed} reports on ${new Date(a.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, about ${Math.round(Number(a.ratio))} times the usual.`
  }) as Row);

  const envMap = Object.fromEntries(env.map((e) => [e.metric, Number(e.v)]));
  const [mTN, mCH, wCH, wTN, byMarket] = await Promise.all([mandi("tamil_nadu"), mandi("chennai_markets"), mandiWeekly("chennai_region"),
    mandiWeekly("tamil_nadu"), mandiMarkets()]);
  const kg = (v: number) => `₹${(v / 100).toFixed(0)}`;
  // Chennai's own markets when they have reported; else the districts around Chennai, else the state
  const market = byMarket.commodities.length
    ? byMarket.commodities.slice(0, 3).map((c) => {
        const at = Object.entries(c.prices).sort((a, b) => a[1].price - b[1].price);
        const d = c.avg != null && c.avgPrev ? Math.round(((c.avg - c.avgPrev) / c.avgPrev) * 100) : null;
        return `${c.commodity} ${kg(c.avg ?? 0)}/kg across ${plural(c.markets, "Chennai market")}` +
          (at.length > 1 ? ` (${kg(at[0][1].price)} at ${at[0][0]} to ${kg(at[at.length - 1][1].price)} at ${at[at.length - 1][0]})` : "") +
          (d ? `, ${d > 0 ? "up" : "down"} ${Math.abs(d)}% on the previous report` : "");
      })
    : (mCH.commodities.length ? mCH : mTN).commodities.slice(0, 3).map((c) => {
        const d = c.prev ? Math.round(((c.price - c.prev) / c.prev) * 100) : null;
        return `${c.commodity} ₹${(c.price / 100).toFixed(0)}/kg${d ? ` (${d > 0 ? "up" : "down"} ${Math.abs(d)}% in a day)` : ""}`;
      });
  const conditions = [
    envMap.rainfall_24h_mm != null ? `rainfall ${envMap.rainfall_24h_mm} mm in 24 h` : null,
    envMap.aqi != null ? `air quality ${Math.round(envMap.aqi)} AQI` : null,
    envMap.lake_pct_full != null ? `reservoirs ${envMap.lake_pct_full}% full` : null
  ].filter(Boolean).join(", ");

  // --------------------------------------------------- department list --
  const perDept = new Map<string, Row[]>();
  const topByDept = await q(
    `SELECT * FROM (SELECT ${INC}, ROW_NUMBER() OVER (PARTITION BY i.lead_dept ORDER BY i.priority_score DESC) AS rk
                    ${FROM} WHERE ${w.sql} AND i.is_open = 1) x WHERE rk <= 3`, w.params);
  for (const i of topByDept) (perDept.get(i.dept) ?? perDept.set(i.dept, []).get(i.dept)!).push(i);
  const deptActions = deptRows.map((d) => ({
    code: d.code, name: d.name ?? d.code, head: d.head, open: Number(d.open), overdue: Number(d.overdue ?? 0), serious: Number(d.serious ?? 0),
    awaiting: Number(d.awaiting ?? 0), complaints: Number(d.complaints ?? 0),
    followUps: (perDept.get(d.code) ?? []).map((i) => ({ id: i.id, title: i.title || i.type, sev: i.sev, overdue: Number(i.breached) === 1, next: proposed(i) }))
  }));

  // -------------------------------------------------------------- trends --
  const seriesOf = (rows: Row[], keys: string[]) => {
    const tot = new Map<string, number>();
    for (const r of rows) tot.set(r.cat, (tot.get(r.cat) ?? 0) + Number(r.n));
    const topCats = [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
    if (s.cat && !topCats.includes(s.cat) && tot.has(s.cat)) topCats[7] = s.cat;
    const idx = new Map(keys.map((kk, j) => [kk, j]));
    const lines = topCats.map((c) => ({ cat: c, label: catLabel.get(c) ?? c, total: tot.get(c) ?? 0, values: keys.map(() => 0) }));
    const other = { cat: "OTHERS", label: "All other categories", total: 0, values: keys.map(() => 0) };
    for (const r of rows) {
      const j = idx.get(r.b);
      if (j == null) continue;
      const line = lines.find((l) => l.cat === r.cat) ?? other;
      line.values[j] += Number(r.n);
      if (line === other) other.total += Number(r.n);
    }
    return other.total ? [...lines, other] : lines;
  };
  const nowD = new Date(now.replace(" ", "T") + "+05:30");
  const monday = new Date(nowD.getTime() - ((nowD.getDay() + 6) % 7) * 864e5);
  const weeks = Array.from({ length: 12 }, (_, j) => new Date(monday.getTime() - (12 - j) * 7 * 864e5).toISOString().slice(0, 10));
  const months = Array.from({ length: 6 }, (_, j) => { const d = new Date(nowD.getFullYear(), nowD.getMonth() - (5 - j), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });

  // the zone adding the most reports to each category, last 4 weeks against the 4 before
  const whereRising: Record<string, { zone: number; name: string; recent: number; before: number }> = {};
  for (const r of catZones) {
    const d = Number(r.recent) - Number(r.before_);
    const cur = whereRising[r.cat];
    if (d > 0 && (!cur || d > cur.recent - cur.before)) whereRising[r.cat] = { zone: Number(r.zone), name: zn.get(Number(r.zone)) ?? `Zone ${r.zone}`, recent: Number(r.recent), before: Number(r.before_) };
  }

  // ----------------------------------------------------------- patterns --
  const hs = hotspots
    .map((h) => {
      const wz = String(h.wards ?? "").split(/[|,;\s]+/).map(Number).filter(Boolean).map((x) => wardZone.get(x)).filter(Boolean) as number[];
      return { ...h, label: catLabel.get(h.cat) ?? h.cat, zone: wz[0] ?? null, zone_name: wz[0] ? zn.get(wz[0]) : null } as Row;
    })
    .filter((h: Row) => (!zone || h.zone === zone) && (!s.cat || h.cat === s.cat))
    .slice(0, 8);

  const reviewCounts = Object.fromEntries(review.map((r) => [r.item_type, Number(r.n)]));
  // Items from sources the Collector added: civic issues first, then the newest.
  const added = await addedItems({ now, days: Math.max(1, Math.round(PERIODS[period].hours / 24)), since: periodSince(period, now), zone, dept, cat: s.cat, taluk: s.taluk }, 60);
  const fromSources = [...added.items].sort((a, b) => Number(b.is_incident) - Number(a.is_incident) || String(b.t).localeCompare(String(a.t))).slice(0, 5);

  const md = [
    `# Collector's Briefing: ${scope}`, `_${PERIODS[period].label}, data as of ${now}_`, "", "## At a glance", ...headline.map((h) => `- ${h}`),
    conditions ? `- Conditions: ${conditions}.` : "", market.length ? `- Markets: ${market.join("; ")}.` : "", "", "## Needs your attention",
    ...attention.map((a, j) => `${j + 1}. **${a.title}** (${a.sev}, ${a.zone ?? "Chennai"}; ${a.status}). What happened: ${a.why.summary} ` +
      `Why it needs you: ${a.why.attention.join("; ")}. Evidence: ${a.evidence}.${a.next ? ` Next: ${a.next.owner ?? ""} - ${a.next.text}.` : ""} \`${a.id}\``),
    handledByDepts ? `\n_${plural(handledByDepts, "other open incident")} ${handledByDepts === 1 ? "is" : "are"} routine and left to the departments._` : "",
    emerging.length ? "\n## Emerging patterns" : "", ...emerging.map((e) => `- ${e.text}`),
    gaps.length ? `\n## In the news, not in department records\n- ${plural(gaps.length, "incident")}; top: ${gaps.slice(0, 3).map((g) => g.title).join("; ")}.` : "",
    fromSources.length ? `\n## From added sources\n_${plural(added.count, "item")} in the last ${added.days} days from sources you added; ${added.civic} read as civic issues._` : "",
    ...fromSources.map((i) => `- **${i.title}** (${[i.source, i.place ?? i.zone_name, String(i.t).slice(0, 16)].filter(Boolean).join(", ")})` +
      `${i.category_label ? `: ${i.category_label}` : ""}.${i.url ? ` Source: ${i.url}` : ""}`)
  ].filter((x) => x !== "").join("\n");

  return {
    now, scope,
    briefing: {
      headline, conditions, market, attention, emerging, fromSources,
      stats: { reported: n, change: ch, open, overdue, severe: sev, multi: Number(K.multi ?? 0), newsOnly: Number(K.news_only ?? 0), handledByDepts },
      env: { rain: envMap.rainfall_24h_mm ?? null, aqi: envMap.aqi != null ? Math.round(envMap.aqi) : null, lakes: envMap.lake_pct_full ?? null }, addedCount: added.count, addedDays: added.days, md, method: "Generated from the store by rules (no language model); every item links to its evidence." },
    deptActions,
    gaps: gaps.map((g) => ({ ...g, why: explain(g) }) as Row),
    trends: { weekly: { keys: weeks, lines: seriesOf(weekly, weeks) }, monthly: { keys: months, lines: seriesOf(monthly, months) }, where: whereRising },
    taluks: taluks.map((t) => ({ code: t.code, name: t.name, open: Number(t.open), severe: Number(t.severe), overdue: Number(t.overdue),
      reported: Number(t.reported), prev: Number(t.prev) })),
    patterns: { emerging, hotspots: hs },
    review: { unplaced, unplacedTotal: Number(unplacedN[0]?.n ?? unplaced.length), links: reviewCounts.link ?? 0, gaps: reviewCounts.gap ?? 0 },
    markets: { chennai: mCH, tamilNadu: mTN, weekly: { chennai: wCH, tamilNadu: wTN }, byMarket }
  };
}
export type Insights = Awaited<ReturnType<typeof insights>>;

// ------------------------------------------------------ pattern detail --

export type PatternQuery = { kind: "spike"; cat: string; zone: number | null; date: string } | { kind: "hotspot"; id: string }
  | { kind: "category"; cat: string };

/** "about 1 a day", "about 1 every 3 days": what is normal for a place, in words. */
function usual(perDay: number) {
  if (perDay >= 0.95) return `about ${Math.round(perDay)} a day`;
  const every = Math.max(2, Math.round(1 / Math.max(perDay, 0.01)));
  return every > 60 ? "almost never" : `about 1 every ${every} days`;
}
const dayWord = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/**
 * One unusual spike or recurring hotspot for the Trends page: what happened in plain words,
 * the day-by-day (or month-by-month) counts, the places, and every incident behind it.
 */
export async function pattern(p: PatternQuery) {
  const now = await asOf();
  const cats = categories();
  const catLabel = new Map(cats.map((c) => [c.code, c.label]));
  const playbook = new Map(cats.map((c) => [c.code, c.playbook]));
  const zones = await q(`SELECT DISTINCT zone_no, zone_name FROM ref_wards`);
  const zn = new Map(zones.map((z) => [Number(z.zone_no), String(z.zone_name)]));

  const incidentsOf = async (sql: string, params: unknown[]) => {
    const rows = await q(`SELECT ${INC}, i.lat, i.lon ${FROM} WHERE ${sql} ORDER BY i.first_reported_at DESC LIMIT 60`, params);
    return rows.map((r) => ({ ...r, plain: explain(r) }) as Row);
  };
  const placesOf = (rows: Row[]) => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = String(r.loc || r.zone_name || "Place not given"); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
  };
  const deptsOf = (rows: Row[]) => [...new Set(rows.map((r) => r.dept_name ?? r.dept).filter(Boolean))] as string[];

  if (p.kind === "category") {
    // one category, district-wide: the last 4 weeks against the 4 before, week by week, zone by zone
    const label = catLabel.get(p.cat) ?? p.cat;
    const [weeks, zonesChg, rows, depts, openN] = await Promise.all([
      // full Monday-to-Sunday weeks before this week, the same buckets as the Trends list, so the numbers match
      q(`SELECT FLOOR((DATEDIFF(${MON}, DATE(i.first_reported_at)) - 1) / 7) AS w, COUNT(*) AS n FROM incidents i
         WHERE i.category_code = ? AND i.first_reported_at >= ${MON} - INTERVAL 84 DAY AND i.first_reported_at < ${MON} GROUP BY w`,
        [now, now, p.cat, now, now, now, now]),
      q(`SELECT i.zone_no AS zone, SUM(i.first_reported_at >= ${MON} - INTERVAL 28 DAY) AS recent, SUM(i.first_reported_at < ${MON} - INTERVAL 28 DAY) AS before_
         FROM incidents i WHERE i.category_code = ? AND i.zone_no IS NOT NULL AND i.first_reported_at >= ${MON} - INTERVAL 56 DAY AND i.first_reported_at < ${MON}
         GROUP BY i.zone_no`, [now, now, now, now, p.cat, now, now, now, now]),
      incidentsOf(`i.category_code = ? AND i.first_reported_at >= ${MON} - INTERVAL 28 DAY AND i.first_reported_at < ${MON}`, [p.cat, now, now, now, now]),
      q(`SELECT dp.name, COUNT(*) AS n ${FROM} WHERE i.category_code = ? AND i.first_reported_at >= ${MON} - INTERVAL 28 DAY AND i.first_reported_at < ${MON}
         GROUP BY dp.name ORDER BY n DESC LIMIT 2`, [p.cat, now, now, now, now]),
      q(`SELECT COALESCE(SUM(i.is_open), 0) AS n FROM incidents i WHERE i.category_code = ? AND i.first_reported_at >= ${MON} - INTERVAL 28 DAY
         AND i.first_reported_at < ${MON}`, [p.cat, now, now, now, now])
    ]);
    const byW = new Map(weeks.map((x) => [Number(x.w), Number(x.n)]));
    const recent = [0, 1, 2, 3].reduce((a, k) => a + (byW.get(k) ?? 0), 0);
    const before = [4, 5, 6, 7].reduce((a, k) => a + (byW.get(k) ?? 0), 0);
    const chg = before ? Math.round(((recent - before) / before) * 100) : null;
    const series = Array.from({ length: 12 }, (_, j) => {
      const w = 11 - j;
      const d0 = new Date(now.slice(0, 10) + "T00:00:00");
      const start = new Date(d0.getTime() - ((d0.getDay() + 6) % 7) * 864e5 - (w + 1) * 7 * 864e5); // the week's Monday
      return { label: start.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), n: byW.get(w) ?? 0, hl: w < 4 };
    });
    const zs = zonesChg.map((z) => ({ name: zn.get(Number(z.zone)) ?? `Zone ${z.zone}`, recent: Number(z.recent), before: Number(z.before_), d: Number(z.recent) - Number(z.before_) }));
    const up = zs.filter((z) => z.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
    const down = zs.filter((z) => z.d < 0).sort((a, b) => a.d - b.d).slice(0, 2);
    const open = Number(openN[0]?.n ?? 0);
    const word = chg == null ? "new this month" : chg >= 10 ? `${chg}% more` : chg <= -10 ? `${Math.abs(chg)}% fewer` : "about the same";
    const lead = [
      `${recent.toLocaleString("en-IN")} incidents of ${label.toLowerCase()} in the last 4 full weeks, against ${before.toLocaleString("en-IN")} in the 4 weeks before: ${word}.`,
      up.length ? `The increase is mostly in ${up.map((z) => `${z.name} (+${z.d})`).join(", ")}.` : "No zone had more reports than before.",
      down.length ? `Fewer than before in ${down.map((z) => `${z.name} (${z.d})`).join(", ")}.` : "",
      `${open} of those ${recent.toLocaleString("en-IN")} are still open${depts.length ? `, mostly with ${depts.map((x) => x.name).join(" and ")}` : ""}.`
    ].filter(Boolean);
    return {
      kind: "category" as const, title: label, when: "District-wide · last 12 weeks", lead,
      stats: [
        { l: "Last 4 weeks", v: recent.toLocaleString("en-IN") }, { l: "4 weeks before", v: before.toLocaleString("en-IN") },
        { l: "Change", v: chg == null ? "new" : `${chg > 0 ? "+" : ""}${chg}%` }, { l: "Still open", v: String(open) }
      ],
      seriesTitle: "Incidents per week, by the week's Monday (darker = last 4 full weeks)",
      series, places: up.map((z) => ({ name: z.name, n: z.d })), placesTitle: "Zones adding the most reports",
      incidents: rows, next: playbook.get(p.cat)?.[0] ?? null, filter: { cat: p.cat, zone: null }
    };
  }

  if (p.kind === "spike") {
    const zoneName = p.zone ? zn.get(p.zone) ?? `Zone ${p.zone}` : "the district";
    const label = catLabel.get(p.cat) ?? p.cat;
    const zoneSql = p.zone ? "AND i.zone_no = ?" : "";
    const zp = p.zone ? [p.zone] : [];
    const [an, days, rows] = await Promise.all([
      q(`SELECT observed, expected, ratio FROM anomalies WHERE date = ? AND category_code = ? ${p.zone ? "AND zone_no = ?" : ""} LIMIT 1`, [p.date, p.cat, ...zp]),
      // three weeks before the spike and up to a week after it, so the jump and what followed are both visible
      q(`SELECT DATE_FORMAT(DATE(i.first_reported_at), '%Y-%m-%d') AS d, COUNT(*) AS n FROM incidents i
         WHERE i.category_code = ? ${zoneSql} AND i.first_reported_at >= DATE(?) - INTERVAL 20 DAY
           AND i.first_reported_at < LEAST(DATE(?) + INTERVAL 8 DAY, DATE(?) + INTERVAL 1 DAY) GROUP BY d`, [p.cat, ...zp, p.date, p.date, now]),
      incidentsOf(`i.category_code = ? ${zoneSql} AND DATE(i.first_reported_at) = ?`, [p.cat, ...zp, p.date])
    ]);
    const a = an[0];
    const expected = a ? Number(a.expected) : 0;
    const observed = a ? Number(a.observed) : rows.length;
    const byDay = new Map(days.map((d) => [d.d, Number(d.n)]));
    const end = new Date(Math.min(new Date(p.date + "T00:00:00").getTime() + 7 * 864e5, new Date(now.slice(0, 10) + "T00:00:00").getTime()));
    const series: { label: string; n: number; hl: boolean }[] = [];
    for (let t = new Date(p.date + "T00:00:00").getTime() - 20 * 864e5; t <= end.getTime(); t += 864e5) {
      const d = new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
      series.push({ label: dayWord(d), n: byDay.get(d) ?? 0, hl: d === p.date });
    }
    const after = series.slice(series.findIndex((x) => x.hl) + 1);
    const places = placesOf(rows);
    const open = rows.filter((r) => Number(r.open) === 1).length;
    const one = places.length === 1 || (places[0] && places[0].n >= rows.length * 0.6);
    const lead = [
      `${observed} reports about ${label.toLowerCase()} came in from ${zoneName} on ${dayWord(p.date)}. This place normally gets ${usual(expected)}, so that day had about ${Math.round(Number(a?.ratio ?? 0))} times the usual number.`,
      one && places[0] ? `Most of them are about one place, ${places[0].name}: probably one problem that several people reported.`
        : `They are spread over ${places.length} places, so check whether they share a cause (rain, a works site, an event).`,
      after.length ? (after.some((x) => x.n >= Math.max(2, observed / 2)) ? "Reports stayed high on the days after: it has not settled." : "Reports dropped back on the days after.") : "This is the latest day with data.",
      rows.length ? `${open} of the ${rows.length} ${rows.length === 1 ? "incident is" : "incidents are"} still open, handled by ${deptsOf(rows).join(", ") || "the department"}.` : ""
    ].filter(Boolean);
    return {
      kind: "spike" as const, title: `${label} in ${zoneName}`, when: dayWord(p.date), lead,
      stats: [
        { l: "Reports that day", v: String(observed) }, { l: "Usual for this place", v: usual(expected) },
        { l: "Times the usual", v: `${Number(a?.ratio ?? 0).toFixed(1)}×` }, { l: "Still open", v: `${open} of ${rows.length}` }
      ],
      seriesTitle: "Reports per day, three weeks before and the days after",
      series, places: places.slice(0, 6), incidents: rows, next: playbook.get(p.cat)?.[0] ?? null,
      filter: { cat: p.cat, zone: p.zone }
    };
  }

  const [h] = await q(`SELECT hotspot_id AS id, category_code AS cat, incidents, incidents_30d, open, lat, lon, wards, top_place,
    DATE_FORMAT(first_seen, '%Y-%m-%d') AS first_seen, DATE_FORMAT(last_seen, '%Y-%m-%d') AS last_seen FROM hotspots WHERE hotspot_id = ?`, [p.id]);
  if (!h) return null;
  const label = catLabel.get(h.cat) ?? h.cat;
  const [rows, months] = await Promise.all([
    incidentsOf(`i.hotspot_id = ?`, [p.id]),
    q(`SELECT DATE_FORMAT(i.first_reported_at, '%Y-%m') AS m, COUNT(*) AS n FROM incidents i WHERE i.hotspot_id = ? GROUP BY m ORDER BY m`, [p.id])
  ]);
  const places = placesOf(rows);
  const zone = rows.find((r) => r.zone)?.zone ?? null;
  const open = rows.filter((r) => Number(r.open) === 1).length;
  const wards = String(h.wards ?? "").split(/[|,;\s]+/).filter(Boolean);
  const lastGap = rows.length > 1 ? Math.round((new Date(String(rows[0].t).replace(" ", "T")).getTime() - new Date(String(rows[1].t).replace(" ", "T")).getTime()) / 864e5) : null;
  const lead = [
    `${label} keeps coming back around ${h.top_place}: ${h.incidents} incidents since ${dayWord(h.first_seen)}, ${h.incidents_30d} of them in the last 30 days.`,
    `The latest was on ${dayWord(h.last_seen)}${lastGap != null ? `, ${lastGap === 0 ? "the same day as" : `${lastGap} day${lastGap === 1 ? "" : "s"} after`} the one before` : ""}. ${open} ${open === 1 ? "is" : "are"} still open.`,
    `Closing each complaint has not stopped it coming back, so a lasting fix at this spot is worth asking ${deptsOf(rows).join(" and ") || "the department"} for.`
  ];
  const monthName = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return {
    kind: "hotspot" as const, title: `${label}: ${h.top_place}`, when: `${dayWord(h.first_seen)} to ${dayWord(h.last_seen)}`, lead,
    stats: [
      { l: "Incidents in all", v: String(h.incidents) }, { l: "In the last 30 days", v: String(h.incidents_30d) },
      { l: "Still open", v: String(open) }, { l: wards.length === 1 ? "Ward" : "Wards", v: wards.join(", ") || "—" }
    ],
    seriesTitle: "Incidents per month at this spot",
    series: months.map((m, k) => ({ label: monthName(m.m), n: Number(m.n), hl: k === months.length - 1 })),
    places: places.slice(0, 6), incidents: rows, next: playbook.get(h.cat)?.[0] ?? null,
    filter: { cat: h.cat, zone: zone != null ? Number(zone) : null }
  };
}
export type PatternDetail = NonNullable<Awaited<ReturnType<typeof pattern>>>;
