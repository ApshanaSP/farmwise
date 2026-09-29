/**
 * Briefing, follow-ups, trends and patterns for the Collector console's Briefing and
 * Trends pages. Every sentence is built from the store's own numbers and carries the
 * incident IDs behind it, so each claim can be opened and checked.
 */
import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { PERIODS, asOf, explain, type Focus, type Period } from "@/lib/collector/intel";
import { categories } from "@/lib/collector/nlp";
import { addedItems, mandi, mandiMarkets, mandiWeekly } from "@/lib/collector/sources";

type Row = Record<string, any>;
async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await intelPool.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}

interface Scope { period: Period; zone: number | null; dept: string | null; cat: string | null; taluk: string | null }

function where(s: Scope, now: string, opts: { hours?: number; offset?: number; noCat?: boolean } = {}) {
  const h = opts.hours ?? PERIODS[s.period].hours;
  const off = opts.offset ?? 0;
  const parts = [`i.first_reported_at > (? - INTERVAL ? HOUR)`, `i.first_reported_at <= (? - INTERVAL ? HOUR)`];
  const params: unknown[] = [now, h * (off + 1), now, h * off];
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

export async function insights(period: Period, zone: number | null, dept: string | null, focus: Focus = {}) {
  const now = await asOf();
  const s: Scope = { period, zone, dept, cat: focus.cat ?? null, taluk: focus.taluk ?? null };
  const w = where(s, now), pw = where(s, now, { offset: 1 });
  const cats = categories();
  const playbook = new Map(cats.map((c) => [c.code, c.playbook]));
  const catLabel = new Map(cats.map((c) => [c.code, c.label]));

  const [k, kp, top, nextActs, deptRows, gaps, weekly, monthly, taluks, anomalies, hotspots, unplaced, review, zoneNames, env] = await Promise.all([
    q(`SELECT COUNT(*) AS n, SUM(i.severity_level = 'Severe') AS severe, SUM(i.is_open) AS open,
              SUM(i.is_open = 1 AND i.sla_breached = 1) AS overdue, SUM(i.citizen_complaints) AS complaints,
              SUM(i.source_count > 1) AS multi, SUM(i.media_only) AS news_only
       FROM incidents i WHERE ${w.sql}`, w.params),
    q(`SELECT COUNT(*) AS n, SUM(i.severity_level = 'Severe') AS severe FROM incidents i WHERE ${pw.sql}`, pw.params),
    // incidents that need the Collector's attention: open, highest priority first
    q(`SELECT ${INC} ${FROM} WHERE ${w.sql} AND i.is_open = 1 ORDER BY i.priority_score DESC LIMIT 6`, w.params),
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
       WHERE ${where(s, now, { hours: Math.max(PERIODS[period].hours, 7 * 24) }).sql} AND i.media_only = 1 AND i.status_std <> 'Lapsed'
       ORDER BY i.priority_score DESC LIMIT 40`, where(s, now, { hours: Math.max(PERIODS[period].hours, 7 * 24) }).params),
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
       AND i.zone_no IS NULL AND i.is_open = 1 ORDER BY i.priority_score DESC LIMIT 30`,
      where({ ...s, zone: null }, now, { hours: Math.max(PERIODS[period].hours, 720) }).params),
    q(`SELECT item_type, COUNT(*) AS n FROM review_queue WHERE status IN ('open', 'pending', 'new') OR status IS NULL GROUP BY item_type`),
    q(`SELECT DISTINCT zone_no, zone_name, ward_no FROM ref_wards`),
    q(`SELECT metric, ROUND(AVG(value), 1) AS v FROM (
         SELECT o.metric, o.place_id, o.value, ROW_NUMBER() OVER (PARTITION BY o.metric, o.place_id ORDER BY o.observed_at DESC) rn
         FROM observations o WHERE o.metric IN ('rainfall_24h_mm', 'aqi', 'lake_pct_full') AND o.observed_at <= ?) x WHERE rn = 1 GROUP BY metric`, [now])
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

  const attention = top.map((i) => ({
    id: i.id, title: i.title || `${i.type} – ${i.loc ?? i.zone_name ?? "Chennai"}`, sev: i.sev, status: i.status, zone: i.zone_name, dept: i.dept_name ?? i.dept,
    why: explain(i), evidence: `${plural(Number(i.member_count), "report")} from ${String(i.sources).split("|").map((x) => SOURCE_NAME[x] ?? x).join(", ")}`,
    next: proposed(i), overdue: Number(i.breached) === 1, confidence: i.confidence == null ? null : Number(i.confidence)
  }));

  const emerging = anomalies.slice(0, 6).map((a) => ({
    ...a, label: catLabel.get(a.cat) ?? a.cat, zone_name: zn.get(Number(a.zone)) ?? null,
    text: `${catLabel.get(a.cat) ?? a.cat} in ${zn.get(Number(a.zone)) ?? "the district"}: ${a.observed} reports on ${a.date} against about ${Number(a.expected).toFixed(1)} expected (${Number(a.ratio).toFixed(1)}×).`
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
    const topCats = [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
    if (s.cat && !topCats.includes(s.cat) && tot.has(s.cat)) topCats[5] = s.cat;
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
  const added = await addedItems({ now, days: Math.max(7, Math.round(PERIODS[period].hours / 24)), zone, dept, cat: s.cat, taluk: s.taluk }, 60);
  const fromSources = [...added.items].sort((a, b) => Number(b.is_incident) - Number(a.is_incident) || String(b.t).localeCompare(String(a.t))).slice(0, 5);

  const md = [
    `# Collector's Briefing: ${scope}`, `_${PERIODS[period].label}, data as of ${now}_`, "", "## At a glance", ...headline.map((h) => `- ${h}`),
    conditions ? `- Conditions: ${conditions}.` : "", market.length ? `- Markets: ${market.join("; ")}.` : "", "", "## Needs your attention",
    ...attention.map((a, j) => `${j + 1}. **${a.title}** (${a.sev}, ${a.zone ?? "Chennai"}; ${a.status}). Why: ${[...a.why.what, ...a.why.why].slice(0, 4).join("; ")}. ` +
      `Evidence: ${a.evidence}.${a.next ? ` Next: ${a.next.owner ?? ""} - ${a.next.text}.` : ""} \`${a.id}\``),
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
      stats: { reported: n, change: ch, open, overdue, severe: sev, multi: Number(K.multi ?? 0), newsOnly: Number(K.news_only ?? 0) },
      env: { rain: envMap.rainfall_24h_mm ?? null, aqi: envMap.aqi != null ? Math.round(envMap.aqi) : null, lakes: envMap.lake_pct_full ?? null }, addedCount: added.count, addedDays: added.days, md, method: "Generated from the store by rules (no language model); every item links to its evidence." },
    deptActions,
    gaps: gaps.map((g) => ({ ...g, why: explain(g) }) as Row),
    trends: { weekly: { keys: weeks, lines: seriesOf(weekly, weeks) }, monthly: { keys: months, lines: seriesOf(monthly, months) } },
    taluks: taluks.map((t) => ({ code: t.code, name: t.name, open: Number(t.open), severe: Number(t.severe), overdue: Number(t.overdue),
      reported: Number(t.reported), prev: Number(t.prev) })),
    patterns: { emerging, hotspots: hs },
    review: { unplaced, links: reviewCounts.link ?? 0, gaps: reviewCounts.gap ?? 0 },
    markets: { chennai: mCH, tamilNadu: mTN, weekly: { chennai: wCH, tamilNadu: wTN }, byMarket }
  };
}
export type Insights = Awaited<ReturnType<typeof insights>>;
