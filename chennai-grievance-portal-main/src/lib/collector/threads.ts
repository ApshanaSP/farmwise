/**
 * Developing stories: news reports about the same event, followed over several days.
 *
 * The news monitor groups same-day coverage of one article into a story (documents.story_id)
 * and the pipeline links reports to incidents. A continuing event, though, is reported again
 * as it develops (the attack, the arrests, the death, the court case) under new headlines,
 * new stories and sometimes new incidents. This module threads those reports together:
 *
 *   1. Reports in the window, oldest first: district news that is an incident, linked to one,
 *      or carries a civic category, plus dated items from sources the Collector added.
 *   2. Each report joins the open thread it matches best (last update within 4 days, thread
 *      at most 14 days long), or starts a new one. It matches when it shares the story or the
 *      incident, or when its headline is close to the thread's (TF-IDF cosine with the thread
 *      centroid or its nearest member) and they share at least one rare word (a place, a name).
 *      Two different named localities, or none of the thread's own words (the name or place in
 *      most of its reports), keep events apart.
 *   3. A thread is shown when it has two or more different headlines from different stories
 *      or several hours apart, from two outlets or in three or more reports. Each report gets a stage (arrest, death, court, action...) from
 *      its headline, so the thread reads as what happened, in order.
 *
 * Rules only, no language model; every step links to its article or incident.
 */
import crypto from "crypto";
import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { categories } from "@/lib/collector/nlp";

type Row = Record<string, any>;
async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await intelPool.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}

/** `hours` is the dashboard period; stories are followed over at least 14 and at most 30 days. */
export interface ThreadScope { hours: number; /** only stories with a report since then (the period start: daily = today) */ since?: string; zone: number | null; dept: string | null; cat: string | null; taluk: string | null }

interface Doc {
  id: string; story: string | null; inc: string | null; itemId: number | null; publisher: string | null; title: string; url: string | null;
  lang: string | null; cat: string | null; dept: string | null; place: string | null; local: boolean; zone: number | null; taluk: string | null;
  sev: string | null; open: boolean | null; t: string; ms: number; w: Map<string, number>; norm: number; tk: string[];
}

// ------------------------------------------------------------ headlines --

const STOP = new Set(("a an the of in on at to for from by with and or but is are was were be been being as into over after before near about against amid " +
  "chennai city tamil nadu tn govt government police says said say new two three four five one held arrested arrest man woman youth people residents " +
  "day days week weeks today tomorrow yesterday its his her their this that these those will would may can could not no up out off also more than per " +
  "rs crore lakh year years old last first all under via how why what who when where tap know inshorts news").split(/\s+/));
const SYN: Record<string, string> = {
  murdered: "kill", murder: "kill", murders: "kill", killed: "kill", kills: "kill", hacked: "kill", slain: "kill",
  dies: "die", died: "die", death: "die", dead: "die", deaths: "die", succumbs: "die",
  afire: "fire", ablaze: "fire", blaze: "fire", fires: "fire", drowned: "drown", drowns: "drown", drowning: "drown",
  flooded: "flood", flooding: "flood", floods: "flood", inundated: "flood", waterlogged: "waterlog", waterlogging: "waterlog",
  rains: "rain", rainfall: "rain", collapsed: "collapse", collapses: "collapse", "sub-inspector": "si", subinspector: "si",
  husband: "spouse", wife: "spouse", friends: "friend", girls: "girl", boys: "boy", students: "student", workers: "worker", roads: "road", drains: "drain"
};

/** "Headline | Outlet" and "Headline - India Today": keep the headline. */
function cleanTitle(t: string) {
  let s = String(t ?? "").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*\|\s*Tap to know more.*$/i, "");
  for (let k = 0; k < 2; k++) {
    const m = s.match(/^(.{25,}?)\s+[|–-]\s+([^|–-]{2,32})$/);
    if (m && !/\d/.test(m[2])) s = m[1].trim();
  }
  return s;
}

function tokens(s: string) {
  const out: string[] = [];
  for (let w of s.toLowerCase().replace(/[‘’'`"“”]/g, "").split(/[^a-z0-9஀-௿-]+/)) {
    w = w.replace(/^-+|-+$/g, "");
    if (!w || w.length < 2 || /^\d+$/.test(w)) continue;
    if (/[஀-௿]/.test(w)) {
      // Tamil words take case endings: compare their first five letters
      const cp = [...w];
      if (cp.length >= 4) out.push("ta:" + cp.slice(0, 5).join(""));
      continue;
    }
    if (w.length < 3 && w !== "si") continue;
    if (STOP.has(w)) continue;
    w = SYN[w] ?? w;
    if (w.length > 4) w = w.replace(/(ing|ed|es|s)$/, "");
    if (STOP.has(w)) continue; // "Chennai's" -> "chennai"
    out.push(w);
  }
  return out;
}

// ---------------------------------------------------------------- stages --

const STAGES: [string, RegExp][] = [
  ["Arrest", /\b(arrest\w*|held|nabbed|detain\w*|custody|surrender\w*)\b|கைது/i],
  ["Death", /\b(dies|died|dead|death|killed|body|bodies|succumb\w*)\b|பலி|உயிரிழ|சடலம்|மரணம்/i],
  ["Court", /\b(court|hc|bail|sentenc\w*|convict\w*|plea|pil|verdict|acquit\w*)\b|நீதிமன்ற|ஐகோர்ட்|நீதிபதி/i],
  ["Probe", /\b(probe|inquiry|investigat\w*|sit|cb-?cid|questioned|summon\w*)\b|விசாரணை/i],
  ["Protest", /\b(protest\w*|agitation|stir|strike|road roko|demonstrat\w*)\b|போராட்ட|மறியல்|ஆர்ப்பாட்ட/i],
  ["Action", /\b(seal\w*|remov\w*|demolish\w*|evict\w*|deploy\w*|restor\w*|cleared|drive|vaccinat\w*|desilt\w*|repair\w*|suspend\w*|fined?|penalt\w*|crackdown|rescu\w*)\b|நடவடிக்கை|அகற்ற|சீல்|மீட்/i],
  ["Warning", /\b(alert|warns?|warning|advisory)\b|எச்சரிக்கை/i],
  ["Completed", /\b(complet\w*|reopen\w*|resum\w*|finish\w*)\b|நிறைவு|திறப்பு/i]
];
const stageOf = (title: string) => STAGES.find(([, re]) => re.test(title))?.[0] ?? "Update";

// ------------------------------------------------------------ geography --

declare global {
  // eslint-disable-next-line no-var
  var __threadWards: Row[] | undefined;
  // eslint-disable-next-line no-var
  var __threadCache: { key: string; at: number; threads: Thread[] } | undefined;
}
async function wards() {
  global.__threadWards ??= await q(`SELECT ward_no, zone_no, taluk_code, centroid_lat AS lat, centroid_lon AS lon FROM ref_wards`);
  return global.__threadWards;
}
function nearestWard(ws: Row[], lat: number, lon: number) {
  let best: Row | null = null, bd = Infinity;
  for (const w of ws) {
    const dy = (Number(w.lat) - lat) * 111.2, dx = (Number(w.lon) - lon) * 111.2 * Math.cos((lat * Math.PI) / 180);
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = w; }
  }
  return bd <= 2 ? best : null;
}

// --------------------------------------------------------------- threads --

export interface ThreadStep {
  t: string; title: string; publisher: string | null; url: string | null; lang: string | null; stage: string;
  incident: string | null; itemId: number | null; added: boolean; also: string[];
}
export interface Thread {
  id: string; title: string; place: string | null; cat: string | null; catLabel: string | null; zones: number[]; depts: string[]; taluks: string[];
  incidents: string[]; sev: string | null; open: boolean | null; first: string; last: string; hours: number; reports: number; outlets: string[];
  added: number; stages: { stage: string; t: string }[]; days: { day: string; steps: ThreadStep[] }[]; latest: ThreadStep;
}

/** Bump when the threading rules change, so a cached result is not reused. */
const RULES = 9;

const SCHEDULE = /power (cut|shutdown)|shutdown areas|மின்தடை|மின் தடை|எந்தெந்த வழக்க/i;

async function load(now: string, days: number): Promise<Doc[]> {
  const [news, added, ws] = await Promise.all([
    q(`SELECT d.doc_id AS id, d.story_id AS story, d.linked_incident_id AS inc, d.publisher, d.title, d.url, d.lang, d.category_code AS cat,
              d.department AS ddept, d.place_text AS place, d.geo_level, d.lat, d.lon, i.zone_no AS izone, i.taluk_code AS italuk, i.lead_dept AS idept,
              i.severity_level AS sev, i.is_open AS open, DATE_FORMAT(d.published_at, '%Y-%m-%d %H:%i:%s') AS t
       FROM documents d LEFT JOIN incidents i ON i.incident_id = d.linked_incident_id
       WHERE d.source_kind = 'news' AND d.is_district = 1 AND d.published_at > (? - INTERVAL ? DAY) AND d.published_at <= ?
         AND (d.is_incident = 1 OR d.linked_incident_id IS NOT NULL OR d.report_type IN ('incident', 'crime', 'civic_complaint', 'court')
              OR d.category_code IS NOT NULL)
       ORDER BY d.published_at`, [now, days, now]),
    q(`SELECT i.item_id, s.name AS publisher, i.title, i.url, i.lang, i.category_code AS cat, i.dept_code AS ddept, i.place, i.lat, i.lon,
              i.zone_no AS izone, i.taluk_code AS italuk, DATE_FORMAT(COALESCE(i.published_at, i.fetched_at), '%Y-%m-%d %H:%i:%s') AS t
       FROM ${ops("source_items")} i JOIN ${ops("sources")} s ON s.source_id = i.source_id
       WHERE s.kind IN ('rss', 'html', 'json', 'ocr') AND (i.published_at IS NOT NULL OR i.origin = 'ocr')
         AND COALESCE(i.published_at, i.fetched_at) > (? - INTERVAL ? DAY)
         AND COALESCE(i.published_at, i.fetched_at) <= ? + INTERVAL 1 DAY`, [now, days, now]).catch(() => [] as Row[]),
    wards()
  ]);
  const cats = new Map(categories().map((c) => [c.code, c.lead]));
  const docs: Doc[] = [];
  const seen = new Set<string>();
  const push = (r: Row, id: string, itemId: number | null) => {
    const title = cleanTitle(r.title);
    if (!title || SCHEDULE.test(title) || !r.t) return;
    const key = `${(r.publisher ?? "").toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const local = !!r.place && (r.geo_level ? !["district", "taluk"].includes(r.geo_level) : true) && String(r.place).toLowerCase() !== "chennai";
    let zone = r.izone == null ? null : Number(r.izone), taluk: string | null = r.italuk ?? null;
    if (zone == null && local && r.lat != null) {
      const w = nearestWard(ws, Number(r.lat), Number(r.lon));
      if (w) { zone = Number(w.zone_no); taluk = taluk ?? w.taluk_code ?? null; }
    }
    const cat = r.cat && r.cat !== "OTHER" ? r.cat : null;
    docs.push({
      id, story: r.story ?? null, inc: r.inc ?? null, itemId, publisher: r.publisher ?? null, title, url: r.url ?? null, lang: r.lang ?? null,
      cat, dept: r.idept ?? r.ddept ?? (cat ? cats.get(cat) ?? null : null), place: r.place ?? null, local, zone, taluk,
      sev: r.sev ?? null, open: r.open == null ? null : Number(r.open) === 1, t: r.t, ms: Date.parse(r.t.replace(" ", "T") + "+05:30"),
      w: new Map(), norm: 1, tk: []
    });
  };
  for (const r of news) push(r, String(r.id), null);
  for (const r of added) push(r, `item-${r.item_id}`, Number(r.item_id));
  docs.sort((a, b) => a.ms - b.ms);
  return docs;
}

function cluster(docs: Doc[]) {
  const df = new Map<string, number>();
  for (const d of docs) {
    // headline words only: the monitor's place tags are sometimes wrong, and a place that matters is in the headline
    d.tk = [...new Set(tokens(d.title))];
    for (const k of d.tk) df.set(k, (df.get(k) ?? 0) + 1);
  }
  const N = Math.max(1, docs.length);
  for (const d of docs) {
    d.w = new Map(d.tk.map((k) => [k, Math.log(1 + N / (df.get(k) ?? 1))]));
    d.norm = Math.hypot(...d.w.values()) || 1;
  }
  const rare = (k: string) => (df.get(k) ?? 0) <= 8;
  interface T { m: Doc[]; c: Map<string, number>; count: Map<string, number>; stories: Set<string>; incs: Set<string>; locs: Set<string>; first: number; last: number }
  const open: T[] = [];
  for (const d of docs) {
    let best: T | null = null, bestScore = 0;
    for (const t of open) {
      if (d.ms - t.last > 4 * 864e5 || d.ms - t.first > 14 * 864e5) continue;
      if ((d.story && t.stories.has(d.story)) || (d.inc && t.incs.has(d.inc))) { best = t; bestScore = 9; break; }
      // a different named locality is a different event
      if (d.local && d.place && t.locs.size && !t.locs.has(d.place.toLowerCase())) continue;
      let dot = 0, cn = 0;
      const shared: string[] = [];
      for (const v of t.c.values()) cn += v * v;
      for (const [k, v] of d.w) if (t.c.has(k)) { dot += v * t.c.get(k)!; shared.push(k); }
      const cos = dot / (d.norm * Math.sqrt(cn) || 1);
      let pair = 0;
      for (const m of t.m) {
        let x = 0;
        for (const [k, v] of d.w) if (m.w.has(k)) x += v * v;
        pair = Math.max(pair, x / (d.norm * m.norm));
      }
      const anchors = shared.filter(rare);
      // The thread's own words: in most of its reports and mostly used there (a company, a person, a place).
      // A report that carries none of them is another event that reads alike (two firms' similar announcements).
      const own = t.m.length >= 2 ? [...t.count.entries()].filter(([k, n]) => n >= 0.8 * t.m.length && n / (df.get(k) ?? 1) >= 0.6).map(([k]) => k) : [];
      const stranger = own.length > 0 && !own.some((k) => d.w.has(k));
      const ok = pair >= 0.9 || (!stranger && (pair >= 0.6 || (cos >= 0.3 && anchors.length >= 1 && shared.length >= 2) || (pair >= 0.42 && anchors.length >= 2)));
      const sc = Math.max(cos, pair);
      if (ok && sc > bestScore) { best = t; bestScore = sc; }
    }
    if (!best) {
      best = { m: [], c: new Map(), count: new Map(), stories: new Set(), incs: new Set(), locs: new Set(), first: d.ms, last: d.ms };
      open.push(best);
    }
    best.m.push(d);
    best.last = Math.max(best.last, d.ms);
    for (const [k, v] of d.w) { best.c.set(k, (best.c.get(k) ?? 0) + v); best.count.set(k, (best.count.get(k) ?? 0) + 1); }
    if (d.story) best.stories.add(d.story);
    if (d.inc) best.incs.add(d.inc);
    if (d.local && d.place) best.locs.add(d.place.toLowerCase());
  }
  return open.map((t) => t.m);
}

const mode = <T,>(xs: T[]) => {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

function build(m: Doc[], catLabel: Map<string, string>): Thread | null {
  const titles = new Set(m.map((d) => d.title.toLowerCase()));
  const units = new Set(m.map((d) => d.story ?? d.id));
  const hours = (m[m.length - 1].ms - m[0].ms) / 3.6e6;
  const outlets = new Set(m.map((d) => d.publisher).filter(Boolean));
  // two headlines from one outlet are often two different stories: ask for a second outlet or a third report
  if (titles.size < 2 || (units.size < 2 && hours < 6) || (outlets.size < 2 && m.length < 3)) return null;
  // the headline closest to the others, English preferred, names the thread
  const score = (d: Doc) => m.reduce((a, o) => {
    if (o === d) return a;
    let x = 0;
    for (const [k, v] of d.w) if (o.w.has(k)) x += v * v;
    return a + x / (d.norm * o.norm);
  }, 0) + (d.lang === "en" ? 0.6 : 0);
  const head = [...m].sort((a, b) => score(b) - score(a))[0];
  // one step per headline; the same headline from other outlets is folded in
  const steps: ThreadStep[] = [];
  const byTitle = new Map<string, ThreadStep>();
  for (const d of m) {
    const k = d.title.toLowerCase();
    const prev = byTitle.get(k);
    if (prev) { if (d.publisher && d.publisher !== prev.publisher && !prev.also.includes(d.publisher)) prev.also.push(d.publisher); continue; }
    const st: ThreadStep = { t: d.t, title: d.title, publisher: d.publisher, url: d.url, lang: d.lang, stage: stageOf(d.title),
      incident: d.inc, itemId: d.itemId, added: d.itemId != null, also: [] };
    byTitle.set(k, st);
    steps.push(st);
  }
  steps[0].stage = "First report";
  const days: Thread["days"] = [];
  for (const s of steps) {
    const day = s.t.slice(0, 10);
    const g = days[days.length - 1];
    if (g && g.day === day) g.steps.push(s);
    else days.push({ day, steps: [s] });
  }
  const stages: Thread["stages"] = [];
  for (const s of steps) if (s.stage !== "Update" && !stages.some((x) => x.stage === s.stage)) stages.push({ stage: s.stage, t: s.t });
  const cat = mode(m.map((d) => d.cat).filter(Boolean) as string[]);
  const lastInc = [...m].reverse().find((d) => d.sev);
  return {
    id: "THR-" + crypto.createHash("sha1").update(m[0].id).digest("hex").slice(0, 10),
    // the monitor's place tag, when a headline names it (tags are sometimes wrong)
    title: head.title, place: mode(m.filter((d) => d.local && m.some((o) => o.title.toLowerCase().includes(String(d.place).toLowerCase()))).map((d) => d.place as string)),
    cat, catLabel: cat ? catLabel.get(cat) ?? cat : null,
    zones: [...new Set(m.map((d) => d.zone).filter((z): z is number => z != null))],
    depts: [...new Set(m.map((d) => d.dept).filter(Boolean) as string[])],
    taluks: [...new Set(m.map((d) => d.taluk).filter(Boolean) as string[])],
    incidents: [...new Set(m.map((d) => d.inc).filter(Boolean) as string[])],
    sev: lastInc?.sev ?? null, open: lastInc ? lastInc.open : null,
    first: m[0].t, last: m[m.length - 1].t, hours: Math.round(hours), reports: m.length,
    outlets: [...new Set(m.map((d) => d.publisher).filter(Boolean) as string[])], added: m.filter((d) => d.itemId != null).length,
    stages, days, latest: steps[steps.length - 1]
  };
}

/** Developing stories in the scope, most recently updated first. */
export async function threads(s: ThreadScope, now: string) {
  const days = Math.min(30, Math.max(14, Math.round(s.hours / 24)));
  const key = `${RULES}|${now}|${days}`;
  let all = global.__threadCache?.key === key && Date.now() - global.__threadCache.at < 5 * 60_000 ? global.__threadCache.threads : null;
  if (!all) {
    const catLabel = new Map(categories().map((c) => [c.code, c.label]));
    all = cluster(await load(now, days)).map((m) => build(m, catLabel)).filter((t): t is Thread => !!t);
    // latest day first; within a day, the stories that have developed furthest
    all.sort((a, b) => b.last.slice(0, 10).localeCompare(a.last.slice(0, 10)) || b.stages.length - a.stages.length || b.days.length - a.days.length ||
      b.reports - a.reports || b.last.localeCompare(a.last));
    global.__threadCache = { key, at: Date.now(), threads: all };
  }
  const shown = all.filter((t) => (!s.since || t.last >= s.since) &&
    (!s.zone || t.zones.includes(s.zone)) && (!s.dept || t.depts.includes(s.dept)) && (!s.cat || t.cat === s.cat) && (!s.taluk || t.taluks.includes(s.taluk)));
  return { days, total: shown.length, threads: shown.slice(0, 40) };
}
export type Threads = Awaited<ReturnType<typeof threads>>;
