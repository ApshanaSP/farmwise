/**
 * Ask District IQ's tools: typed wrappers over the Collector console's own data functions
 * (intel.ts, insights.ts, threads.ts, geo.ts, nlp.ts, sources.ts), so every number the
 * assistant states is a number the console shows. Each tool validates its arguments with
 * zod, runs read-only, and returns rows for the chart plus id'd facts, sources, incident
 * ids, a test-data flag and caveats (types.ts).
 *
 * The router chooses tools by name and description; no number here comes from a model.
 * Rows never carry citizens' details: no complaint text, reporter, phone or email.
 */
import { z } from "zod";
import { PERIODS, asOf, contactsFor, explain, incident, list, overview, search, type Overview } from "@/lib/collector/intel";
import { insights, type Insights } from "@/lib/collector/insights";
import { threads } from "@/lib/collector/threads";
import { mapGeo } from "@/lib/collector/geo";
import { resolvePlace } from "@/lib/collector/nlp";
import { CHENNAI_MARKETS, mandiMarkets, mandiWeekly } from "@/lib/collector/sources";
import { ScopeSchema, refNames, scopeProblems, type AssistantScope } from "@/lib/assistant/scope";
import { closest, matchCommodities } from "@/lib/assistant/fuzzy";
import { semanticSearch, warmUp, type Meta } from "@/lib/assistant/embed";
import { classify } from "@/lib/collector/nlp";
import {
  ENV_METRICS, addedSources, categoryFigures, deptBacklog, envSignals, feeds, incidentFlags, incidentSeries, incidentsByIds, newsGapTotal, placeBreakdown, seriesNormal,
  syntheticShare,
  warningToday, zoneAttention, type EnvMetric
} from "@/lib/assistant/queries";
import type { Fact, SourceRef, ToolResult } from "@/lib/assistant/types";

type Row = Record<string, any>;
type Body = Omit<ToolResult, "tool" | "args">;

export class ToolError extends Error {}

// ------------------------------------------------------------------ helpers --

const memo = new Map<string, { at: number; p: Promise<unknown> }>();
/** One shared result per key for a minute: a question often needs several tools over the same overview. */
function once<T>(key: string, run: () => Promise<T>, ttl = 60_000): Promise<T> {
  const now = Date.now();
  for (const [k, v] of memo) if (now - v.at > ttl) memo.delete(k);
  const hit = memo.get(key);
  if (hit) return hit.p as Promise<T>;
  const p = run();
  memo.set(key, { at: now, p });
  p.catch(() => memo.delete(key));
  return p;
}
const scopeKey = (s: AssistantScope) => `${s.period}|${s.zone ?? ""}|${s.dept ?? ""}|${s.cat ?? ""}|${s.taluk ?? ""}`;

/** The console's overview for the scope, without the news-routing write (the console does that). */
async function ov(s: AssistantScope): Promise<Overview> {
  const now = await asOf();
  return once(`ov|${now}|${scopeKey(s)}`, () => overview(s.period, s.zone, s.dept, { cat: s.cat, taluk: s.taluk }, { route: false }));
}
/** The console's briefing, trends and patterns for the scope. */
async function ins(s: AssistantScope): Promise<Insights> {
  const now = await asOf();
  return once(`ins|${now}|${scopeKey(s)}`, () => insights(s.period, s.zone, s.dept, { cat: s.cat, taluk: s.taluk }));
}

const fact = (id: string, label: string, value: unknown, unit?: string): Fact => ({ id, label, value: Number(value ?? 0), ...(unit ? { unit } : {}) });
const fn = (name: string, detail?: string): SourceRef => ({ kind: "function", name, ...(detail ? { detail } : {}) });
const tbl = (name: string, detail?: string): SourceRef => ({ kind: "table", name, ...(detail ? { detail } : {}) });
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const inr = (v: number) => v.toLocaleString("en-IN");
const periodOf = (s: AssistantScope) => PERIODS[s.period].label.toLowerCase();

/** Test-data share of the scope, as a flag, facts and a caveat. */
async function testShare(s: AssistantScope, now: string) {
  const sh = await syntheticShare(s, now);
  const caveats = !sh.syn ? [] : [sh.syn === sh.n
    ? `All ${inr(sh.n)} incidents in this scope come from test (synthetic) sources.`
    : `${inr(sh.syn)} of ${inr(sh.n)} incidents in this scope come from test (synthetic) sources.`];
  return {
    testData: sh.syn > 0, caveats,
    facts: [fact("scope.incidents", `Incidents reported, ${periodOf(s)}`, sh.n), fact("scope.test_incidents", "Of them from test (synthetic) sources", sh.syn)]
  };
}

/** The fields of an incident row an answer may show: no free text beyond the title, no people. */
function incRow(i: Row, withWhy = false) {
  return {
    id: String(i.id), title: i.title ?? null, type: i.type ?? null, cat: i.cat_code ?? i.cat ?? null, zone: i.zone ?? null,
    zone_name: i.zone_name ?? null, ward: i.ward ?? null, dept: i.dept ?? null, dept_name: i.dept_name ?? null, sev: i.sev ?? null,
    status: i.status ?? null, open: Number(i.open) === 1, complaints: Number(i.complaints ?? 0), t: i.t ?? null,
    lat: i.lat == null ? null : Number(i.lat), lon: i.lon == null ? null : Number(i.lon), sources: i.sources ?? null,
    priority: i.priority == null ? null : round(Number(i.priority)), overdue: Number(i.breached) === 1,
    ...(withWhy ? { why: i.why ?? explain(i) } : {})
  };
}

/** Incident words in Tamil and Tanglish, to their English form in the records. */
const INCIDENT_WORDS: Record<string, string> = {
  "கொலை": "murder", "கொள்ளை": "robbery", "திருட்டு": "theft", "விபத்து": "accident", "தீ விபத்து": "fire", "வெள்ளம்": "flood", "தாக்குதல்": "assault",
  "கடத்தல்": "kidnap", "சங்கிலி": "snatching", "காணவில்லை": "missing", "மூழ்கி": "drown", "மின்சாரம்": "electric", "மரம்": "tree", "கட்டிடம்": "building",
  kolai: "murder", kollai: "robbery", thiruttu: "theft", vibathu: "accident", vibaththu: "accident", vellam: "flood", kadathal: "kidnap"
};

/** Words that describe the question, not the incident (left out of the keyword match of a story). */
const STORY_STOP = new Set(["what", "this", "that", "case", "incident", "tell", "about", "more", "details", "detail", "explain", "happened", "there",
  "which", "when", "where", "with", "from", "enna", "aachu", "pathi", "sollu", "yesterday", "today", "last", "week", "month", "recent", "latest", "show",
  "give", "please", "near", "area", "zone", "ward"]);

const NEWS_CAVEAT = "News answers rest on headlines: about 98% of news rows are headline snippets, and the news incident filter scores F1 0.63.";

/**
 * One incident in full, for incident_detail and incident_story: its facts, plain-language reasons, the pipeline's own
 * summary line (never complaint text), the linked reports in time order, officials, assignment and decisions.
 */
async function incidentBody(id: string, now: string): Promise<Body | null> {
  const [d, flags] = await Promise.all([incident(id), incidentFlags(id)]);
  if (!d) return null;
  const i = d.incident;
  const data = {
    incident: { ...incRow(i), why: i.why, summary: i.summary ?? null, place: i.loc ?? null, closed_at: i.closed_at ?? null, sla_due: i.sla_due ?? null,
      hours_open: i.hours_open == null ? null : round(Number(i.hours_open)), dead: Number(i.dead ?? 0), injured: Number(i.injured ?? 0), taluk: i.taluk_name ?? null,
      dept_head: i.dept_head ?? null, src: i.src ?? null },
    // report titles, sources and times; complaint text stays in the console
    reports: d.reports.map((r) => ({ t: r.t, source: r.source, what: r.what, title: r.title ?? null, publisher: r.publisher ?? null, url: r.url ?? null, first: r.first })),
    officials: d.contacts.map((c) => ({ name: c.name, designation: c.designation, office: c.office, dept_code: c.dept_code, zone_no: c.zone_no })),
    assigned: d.assigned ? { dept_code: d.assigned.dept_code, designation: d.assigned.officer_designation, status: d.assigned.status, at: d.assigned.assigned_at } : null,
    decisions: d.decisions.map((x) => ({ decision: x.decision, t: x.t }))
  };
  return {
    scope: null, asOf: now, data,
    facts: [fact(`inc.${id}.complaints`, "Citizen complaints linked", i.complaints), fact(`inc.${id}.reports`, "Linked reports", d.reports.length),
      fact(`inc.${id}.hours_open`, "Hours open", data.incident.hours_open ?? 0, "hours"), fact(`inc.${id}.priority`, "Priority score", data.incident.priority ?? 0),
      ...(data.incident.dead ? [fact(`inc.${id}.dead`, "Deaths reported", data.incident.dead)] : []),
      ...(data.incident.injured ? [fact(`inc.${id}.injured`, "Injured reported", data.incident.injured)] : []),
      ...(data.incident.ward != null ? [fact(`inc.${id}.ward`, "Ward", data.incident.ward)] : [])],
    sources: [fn("intel.incident"), tbl("incidents"), tbl("incident_members"), tbl("documents")], incidentIds: [id],
    testData: flags.synthetic, caveats: flags.synthetic ? ["This incident includes test (synthetic) records."] : [], untrusted: ["title", "summary"]
  };
}

// -------------------------------------------------------------------- tools --

interface ToolDef<A extends z.ZodTypeAny> {
  name: string;
  /** what the tool answers, for the router and planner prompts */
  description: string;
  args: A;
  /** false: for drawing (maps), never sent to the model */
  llm?: boolean;
  run: (args: z.infer<A>) => Promise<Body>;
}
const tool = <A extends z.ZodTypeAny>(t: ToolDef<A>) => t;
const scopeOnly = z.object({ scope: ScopeSchema.default({}) });

const SEVS = ["Severe", "High", "Medium", "Low"] as const;
const LIST_STATUSES = ["open", "awaiting", "unverified", "verified", "critical", "Open", "Under review", "Assigned", "In progress",
  "Awaiting verification", "Resolved", "Rejected", "Lapsed"] as const;

export const TOOLS = [
  tool({
    name: "overview_kpis",
    description: "Headline figures for the scope, as on the console's four tiles: severe events, open citizen complaints, ongoing (open) incidents and incidents resolved, each with the previous period and a short series.",
    args: scopeOnly,
    async run({ scope }) {
      const d = await ov(scope);
      const P = PERIODS[scope.period];
      const label: Record<string, string> = { severe: "Severe events", complaints: "Open citizen complaints", ongoing: "Ongoing incidents",
        resolved: `Resolved this ${P.unit.toLowerCase()}` };
      const facts: Fact[] = [];
      for (const k of Object.keys(label)) {
        facts.push(fact(`kpi.${k}`, `${label[k]}, ${P.label.toLowerCase()}`, d.kpi.cur[k]), fact(`kpi.${k}.prev`, `${label[k]}, ${P.prev}`, d.kpi.prev[k]));
      }
      const t = await testShare(scope, d.now);
      return {
        scope, asOf: d.now, data: { cur: d.kpi.cur, prev: d.kpi.prev, series: d.kpi.series, labels: label, period: { ...P } },
        facts: [...facts, ...t.facts], sources: [fn("intel.overview", "KPI tiles"), tbl("incidents")], incidentIds: [],
        testData: t.testData, caveats: t.caveats
      };
    }
  }),

  tool({
    name: "zones",
    description: "All 15 GCC zones for the scope (the zone filter is ignored): incidents reported, still open, open citizen complaints, severe, high, and the console's attention score (3 x severe + 1 x high) behind its 'Hotspot zones' tile. For 'which zone needs attention', zone rankings and zone maps.",
    args: scopeOnly,
    async run({ scope }) {
      const now = await asOf();
      const s = { ...scope, zone: null };
      const rows = await zoneAttention(s, now);
      const facts = rows.flatMap((r, k) => [
        fact(`zone.${r.zone}.rank`, `Attention rank of ${r.name}`, k + 1), fact(`zone.${r.zone}.score`, `Attention score of ${r.name}`, r.score),
        fact(`zone.${r.zone}.severe`, `Severe incidents in ${r.name}`, r.severe), fact(`zone.${r.zone}.high`, `High incidents in ${r.name}`, r.high),
        fact(`zone.${r.zone}.n`, `Incidents reported in ${r.name}`, r.n), fact(`zone.${r.zone}.open`, `Open incidents in ${r.name}`, r.open),
        fact(`zone.${r.zone}.complaints`, `Open citizen complaints in ${r.name}`, r.complaints)
      ]);
      const t = await testShare(s, now);
      return {
        scope: s, asOf: now, data: { rows, formula: "attention score = 3 x severe + 1 x high, incidents reported in the period" },
        facts: [...facts, ...t.facts], sources: [fn("intel.scopeWhere"), tbl("incidents"), tbl("ref_wards")], incidentIds: [],
        testData: t.testData, caveats: t.caveats
      };
    }
  }),

  tool({
    name: "zone_profile",
    description: "One zone in depth, as the console's zone snapshot: open incidents, open complaints, severe, busiest department, zonal officer, its attention rank among zones and the top open incidents with the reasons they rank high. For 'why is Zone N ranked first' and area snapshots.",
    args: z.object({ scope: ScopeSchema.default({}), zone: z.number().int().min(1).max(15) }),
    async run({ scope, zone }) {
      const s = { ...scope, zone };
      const d = await ov(s);
      const [ranks, names] = await Promise.all([zoneAttention({ ...scope, zone: null }, d.now), refNames()]);
      const at = ranks.findIndex((r) => r.zone === zone);
      const snap = d.snapshot.kind === "area" ? d.snapshot : null;
      const top = [...d.severity.rows].sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0)).slice(0, 5).map((i) => incRow(i, true));
      const zn = names.zones.get(zone)?.name ?? `Zone ${zone}`;
      const facts = [
        fact(`zone.${zone}.rank`, `Attention rank of ${zn}`, at + 1), fact(`zone.${zone}.score`, `Attention score of ${zn}`, ranks[at]?.score),
        fact(`zone.${zone}.severe`, `Severe incidents in ${zn}`, ranks[at]?.severe), fact(`zone.${zone}.high`, `High incidents in ${zn}`, ranks[at]?.high),
        fact(`zone.${zone}.active`, `Open incidents in ${zn}`, snap?.active), fact(`zone.${zone}.complaints`, `Open citizen complaints in ${zn}`, snap?.complaints),
        ...top.map((i) => fact(`inc.${i.id}.priority`, `Priority score of ${i.id}`, i.priority))
      ];
      const officer = snap?.zoneOfficer ? { name: snap.zoneOfficer.name, designation: snap.zoneOfficer.designation, office: snap.zoneOfficer.office } : null;
      const t = await testShare(s, d.now);
      return {
        scope: s, asOf: d.now,
        data: { zone, name: zn, rank: at + 1, of: ranks.length, row: ranks[at] ?? null, ranks, keyDept: snap?.keyDept ?? null, officer, top,
          formula: "attention score = 3 x severe + 1 x high, incidents reported in the period" },
        facts: [...facts, ...t.facts], sources: [fn("intel.overview", "zone snapshot and severity list"), tbl("incidents")],
        incidentIds: top.map((i) => i.id), testData: t.testData, caveats: t.caveats, untrusted: ["title"]
      };
    }
  }),

  tool({
    name: "departments",
    description: "Departments for the scope (the department filter is ignored), as the console's department list: open incidents, incidents reported, severe, and open incidents awaiting the Collector's verification. For 'severe incidents by department' and department rankings.",
    args: scopeOnly,
    async run({ scope }) {
      const s = { ...scope, dept: null };
      const d = await ov(s);
      const rows = d.deptNav;
      const facts = rows.flatMap((r) => [
        fact(`dept.${r.code}.open`, `Open incidents, ${r.name}`, r.open), fact(`dept.${r.code}.n`, `Incidents reported, ${r.name}`, r.n),
        fact(`dept.${r.code}.severe`, `Severe incidents, ${r.name}`, r.severe), fact(`dept.${r.code}.unverified`, `Awaiting verification, ${r.name}`, r.unverified)
      ]);
      const t = await testShare(s, d.now);
      return { scope: s, asOf: d.now, data: { rows }, facts: [...facts, ...t.facts], sources: [fn("intel.overview", "department list"), tbl("incidents")],
        incidentIds: [], testData: t.testData, caveats: t.caveats };
    }
  }),

  tool({
    name: "severity",
    description: "Severity for the scope: open incidents by severity as the console's severity panel counts them (news complaints already sent to a department are left out), the severity mix of everything reported in the period, and the top open incidents per severity with their reasons.",
    args: scopeOnly,
    async run({ scope }) {
      const d = await ov(scope);
      const counts = d.severity.counts as Record<string, number>;
      const rows = d.severity.rows.map((i) => incRow(i, true));
      const facts = [
        ...SEVS.map((k) => fact(`sev.open.${k}`, `Open ${k} incidents`, counts[k])),
        ...d.severityMix.flatMap((m) => [fact(`sev.reported.${m.sev}`, `${m.sev} incidents reported, ${periodOf(scope)}`, m.n),
          fact(`sev.reported.${m.sev}.open`, `${m.sev} incidents reported and still open`, m.open)])
      ];
      const t = await testShare(scope, d.now);
      return {
        scope, asOf: d.now, data: { open: counts, mix: d.severityMix, rows }, facts: [...facts, ...t.facts],
        sources: [fn("intel.overview", "severity panel"), tbl("incidents")], incidentIds: rows.map((r) => r.id),
        testData: t.testData, caveats: t.caveats, untrusted: ["title"]
      };
    }
  }),

  tool({
    name: "verification_queue",
    description: "Citizen complaints where the department reported the work done and asked for the Collector's verification, with no decision yet (the console's My Tasks), with the officer's reported action.",
    args: scopeOnly,
    async run({ scope }) {
      const d = await ov(scope);
      const rows = d.tasks.rows.map((i) => ({ ...incRow(i), action_step: i.action?.step ?? null, action_at: i.action?.t ?? null, action_note: i.action?.note ?? null }));
      const t = await testShare(scope, d.now);
      return {
        scope, asOf: d.now, data: { count: d.tasks.count, rows }, facts: [fact("tasks.count", "Complaints awaiting your verification", d.tasks.count), ...t.facts],
        sources: [fn("intel.overview", "My Tasks"), tbl("incidents"), tbl("incident_timeline")], incidentIds: rows.map((r) => r.id),
        testData: t.testData, caveats: t.caveats, untrusted: ["title", "action_note"]
      };
    }
  }),

  tool({
    name: "dept_backlog",
    description: "Which department is slowest: departments ranked by the average age of their open incidents (departments with 5 or more open), as the console's backlog card. Covers all open incidents, not only the period; honours the zone filter.",
    args: scopeOnly,
    async run({ scope }) {
      const now = await asOf();
      const rows = await deptBacklog(scope.zone);
      const facts = rows.flatMap((r, k) => [
        fact(`backlog.${r.code}.rank`, `Backlog rank of ${r.name}`, k + 1),
        fact(`backlog.${r.code}.hours`, `Average hours open, ${r.name}`, round(r.hours), "hours"),
        fact(`backlog.${r.code}.days`, `Average days open, ${r.name}`, Math.round(r.hours / 24), "days"),
        fact(`backlog.${r.code}.open`, `Open incidents, ${r.name}`, r.n), fact(`backlog.${r.code}.overdue`, `Open past deadline, ${r.name}`, r.overdue)
      ]);
      const zn = scope.zone ? (await refNames()).zones.get(scope.zone)?.name ?? `Zone ${scope.zone}` : null;
      return {
        // every incident still open, whatever the period: no period on the card
        scope: null, asOf: now, data: { rows: rows.map((r) => ({ ...r, hours: round(r.hours), days: Math.round(r.hours / 24) })) }, facts,
        sources: [fn("intel.overview", "backlog card (same query, every department)"), tbl("incidents")], incidentIds: [], testData: true,
        caveats: [`The backlog covers every incident still open${zn ? ` in ${zn}` : ""}, whatever the period.`]
      };
    }
  }),

  tool({
    name: "incidents",
    description: "Incidents matching filters, 12 per page, as the console's incident list: severity, status ('open', 'awaiting' your verification, 'unverified', 'verified', 'critical' = severe and not verified, or a status name), keyword, sort (t time, sev severity, c complaints, r zone, d department), page; within the period (default) or all 180 days.",
    args: z.object({
      scope: ScopeSchema.default({}),
      sev: z.enum(SEVS).nullable().default(null),
      status: z.enum(LIST_STATUSES).nullable().default(null),
      q: z.string().trim().max(80).nullable().default(null),
      sort: z.enum(["t", "sev", "c", "r", "d"]).default("t"),
      dir: z.union([z.literal(1), z.literal(-1)]).default(-1),
      page: z.number().int().min(0).max(8).default(0),
      allTime: z.boolean().default(false)
    }),
    async run(a) {
      const s = a.scope;
      const r = await list({ period: s.period, zone: s.zone, dept: s.dept, sev: a.sev, cat: s.cat, taluk: s.taluk, status: a.status, q: a.q || null,
        sort: a.sort, dir: a.dir, page: a.page, scope: a.allTime ? "all" : "period" });
      const rows = r.rows.map((i) => incRow(i));
      const now = await asOf();
      return {
        scope: s, asOf: now, data: { rows, total: r.total, complaints: r.complaints, page: a.page, pageSize: 12 },
        facts: [fact("list.total", "Incidents matching", r.total), fact("list.complaints", "Citizen complaints linked to them", r.complaints)],
        sources: [fn("intel.list"), tbl("incidents")], incidentIds: rows.map((x) => x.id),
        testData: true, caveats: a.allTime ? ["Covers all 180 days in the store, not only the period."] : [], untrusted: ["title"]
      };
    }
  }),

  tool({
    name: "incident_detail",
    description: "One incident by its ID (INC-...): facts, plain-language reasons, deadline, the linked reports from each source in time order, the officials responsible and the Collector's decisions.",
    args: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/) }),
    async run({ id }) {
      const now = await asOf();
      return (await incidentBody(id, now)) ?? { scope: null, asOf: now, data: null, facts: [], sources: [fn("intel.incident")], incidentIds: [], testData: false,
        caveats: [`No incident ${id} in the store.`] };
    }
  }),

  tool({
    name: "incident_story",
    description: "Explain one incident the Collector describes in words ('what is this murder case in Adyar', 'tell me about the fire in Guindy', 'what happened at Velachery lake yesterday', or an INC-... id): finds it by meaning (semantic search over every incident's type, title, place and summary, within the zone and category the question names, recent ones first), then gives its full story: what happened, where and when, severity, status, the department and officials, each linked report in time order (news, police, complaints), plus other close matches.",
    args: z.object({ text: z.string().trim().min(2).max(300), scope: ScopeSchema.default({}) }),
    async run({ text, scope }) {
      const now = await asOf();
      warmUp(now);
      const id = text.match(/\bINC-[A-Z0-9-]{4,40}\b/i)?.[0]?.toUpperCase();
      let found: { id: string; score: number }[] = [];
      let how = "id";
      let confident = true;
      if (id) found = [{ id, score: 1 }];
      else {
        const place = await resolvePlace(text);
        const zone = scope.zone ?? place?.zone ?? null;
        const named = classify(text);
        const cats = scope.cat ? [scope.cat] : named && named.conf >= 0.6 ? [named.code] : null;
        // hybrid scoring over every incident in the filter: closeness in meaning, plus the question's own key words found in
        // the incident's type, title and reasons ("murder" is in a murder's reasons, not its generic title; Tamil and
        // Tanglish words count through their English form); recency, the named locality and severity break near-ties
        const nowT = Date.parse(`${now.replace(" ", "T")}+05:30`) / 1000;
        const locality = place?.place?.toLowerCase() ?? null;
        const placeWords = new Set((locality ?? "").split(/\s+/).filter(Boolean));
        const low = text.toLowerCase();
        const local = Object.entries(INCIDENT_WORDS).filter(([k]) => low.includes(k)).map(([, v]) => v);
        const keys = [...new Set([...(low.match(/[a-z]{4,}/g) ?? []), ...local])].filter((w) => !STORY_STOP.has(w) && !placeWords.has(w));
        const lexOf = (words: string | undefined) => keys.filter((w) => (words ?? "").includes(w)).length;
        // the word the question names ("murder") outweighs small differences in meaning between near-identical police records
        const boost = (m: Meta) => Math.min(0.14, 0.07 * lexOf(m.words)) + 0.03 * Math.exp(-Math.max(0, nowT - m.t) / (30 * 86400))
          + (locality && m.place.includes(locality) ? 0.02 : 0) + (m.sev === "Severe" ? 0.01 : 0);
        // the zone and type the question names narrow the search; if nothing matches, each is relaxed in turn
        let hits = await semanticSearch(text, { zone, cats }, 12, boost);
        if (hits && !hits.length && cats) hits = await semanticSearch(text, { zone }, 12, boost);
        if (hits && !hits.length && zone != null) hits = await semanticSearch(text, { cats }, 12, boost);
        if (hits) {
          how = "meaning";
          found = hits.map((h) => ({ id: h.id, score: h.score }));
          // sure only when the question's key words are in the record, or the meaning is very close
          const top = hits[0];
          confident = !top || !keys.length || lexOf(top.meta.words) > 0 || top.sim >= 0.86;
        } else {
          // the meaning index is still being built: the console's keyword search
          how = "keywords";
          found = (await search(text)).incidents.slice(0, 8).map((i, k) => ({ id: String(i.id), score: 1 - k / 100 }));
        }
      }
      if (!found.length) return { scope: null, asOf: now, data: { found: false }, facts: [], sources: [fn("embed.semanticSearch")], incidentIds: [], testData: false,
        caveats: ["No incident in the store matches that description."] };
      const body = await incidentBody(found[0].id, now);
      if (!body) return { scope: null, asOf: now, data: { found: false }, facts: [], sources: [fn("intel.incident")], incidentIds: [], testData: false,
        caveats: [`No incident ${found[0].id} in the store.`] };
      const others = await incidentsByIds(found.slice(1, 6).map((f) => f.id));
      return {
        ...body,
        data: { ...(body.data as Row), found: true, how, confident, others: others.map((o) => ({ id: String(o.id), title: o.title, type: o.type, zone_name: o.zone_name, place: o.place,
          sev: o.sev, status: o.status, t: o.t })) },
        facts: [...body.facts, fact("story.other_matches", "Other incidents close to the description", others.length)],
        sources: [...body.sources, fn("embed.semanticSearch", how === "meaning" ? "multilingual-e5 embeddings" : "keyword fallback")],
        incidentIds: [...body.incidentIds, ...others.map((o) => String(o.id))],
        caveats: [...(confident ? [] : [`No recorded incident clearly matches "${text.slice(0, 80)}"; this is the closest record.`]), ...body.caveats,
          ...(how === "keywords" ? ["Matched by keywords: the meaning search is still being prepared."] : [])],
        untrusted: ["title", "summary", "others"]
      };
    }
  }),

  tool({
    name: "search",
    description: "Find zones, departments and incidents by a name, street, place or incident ID, as the console's search box.",
    args: z.object({ text: z.string().trim().min(2).max(80) }),
    async run({ text }) {
      const [r, now] = await Promise.all([search(text), asOf()]);
      const incidents = r.incidents.map((i) => incRow(i));
      return {
        scope: null, asOf: now, data: { zones: r.zones, depts: r.depts, incidents }, facts: [fact("search.incidents", "Incidents found", incidents.length)],
        sources: [fn("intel.search")], incidentIds: incidents.map((i) => i.id), testData: true, caveats: [], untrusted: ["title"]
      };
    }
  }),

  tool({
    name: "briefing",
    description: "The Collector's briefing for the scope, the one the Briefing page shows (built by rules from the store): headline sentences, figures (reported, % change on the previous period, still open, past deadline, severe, multi-source, news-only), incidents needing attention with reasons and next steps, unusual rises, conditions and market prices.",
    args: scopeOnly,
    async run({ scope }) {
      const i = await ins(scope);
      const b = i.briefing;
      const attention = b.attention.map((a) => ({ id: a.id, title: a.title, sev: a.sev, status: a.status, zone: a.zone, dept: a.dept, why: a.why,
        next: a.next, overdue: a.overdue, evidence: a.evidence }));
      const st = b.stats;
      const facts = [
        fact("briefing.reported", `Incidents reported, ${periodOf(scope)}`, st.reported), fact("briefing.open", "Still open", st.open),
        fact("briefing.overdue", "Open past the deadline", st.overdue), fact("briefing.severe", "Severe events", st.severe),
        fact("briefing.multi", "Incidents from more than one source", st.multi), fact("briefing.news_only", "Incidents only in the news", st.newsOnly),
        fact("briefing.attention", "Incidents needing attention", attention.length)
      ];
      if (st.change != null) facts.push(fact("briefing.change_pct", "Change in incidents reported vs the previous period", st.change, "%"));
      if (b.env.rain != null) facts.push(fact("env.rain", "Rainfall in 24 hours (station average)", b.env.rain, "mm"));
      if (b.env.aqi != null) facts.push(fact("env.aqi", "Air quality index (station average)", b.env.aqi, "AQI"));
      if (b.env.lakes != null) facts.push(fact("env.lakes", "Reservoir storage (average)", b.env.lakes, "% full"));
      const t = await testShare(scope, i.now);
      return {
        scope, asOf: i.now,
        data: { title: i.scope, headline: b.headline, stats: st, attention, emerging: b.emerging, conditions: b.conditions, market: b.market,
          env: b.env, added: { count: b.addedCount, days: b.addedDays }, md: b.md, method: b.method },
        facts: [...facts, ...t.facts], sources: [fn("insights.insights", "briefing"), tbl("incidents"), tbl("actions"), tbl("anomalies"), tbl("observations")],
        incidentIds: attention.map((a) => a.id), testData: t.testData, caveats: t.caveats, untrusted: ["title"]
      };
    }
  }),

  tool({
    name: "dept_followups",
    description: "Department follow-ups for the scope, as the Briefing page's department list: per department its open, past-deadline, serious (severe or high) and awaiting-verification incidents, and its top open incidents with the proposed next step.",
    args: scopeOnly,
    async run({ scope }) {
      const i = await ins(scope);
      const rows = i.deptActions;
      const facts = rows.flatMap((r) => [fact(`dept.${r.code}.open`, `Open incidents, ${r.name}`, r.open), fact(`dept.${r.code}.overdue`, `Past deadline, ${r.name}`, r.overdue),
        fact(`dept.${r.code}.serious`, `Severe or high, ${r.name}`, r.serious), fact(`dept.${r.code}.awaiting`, `Awaiting verification, ${r.name}`, r.awaiting)]);
      const t = await testShare(scope, i.now);
      return { scope, asOf: i.now, data: { rows }, facts: [...facts, ...t.facts], sources: [fn("insights.insights", "department follow-ups"), tbl("actions")],
        incidentIds: rows.flatMap((r) => r.followUps.map((f) => f.id)), testData: t.testData, caveats: t.caveats, untrusted: ["title"] };
    }
  }),

  tool({
    name: "news_gaps",
    description: "Incidents seen in the news with no department record yet (at least the last 7 days), as the Briefing page's 'In the news, not in department records', with the gap finder's suggested action.",
    args: scopeOnly,
    async run({ scope }) {
      const i = await ins(scope);
      const total = await newsGapTotal(scope, i.now);
      const rows = i.gaps.map((g) => ({ ...incRow(g), outlets: Number(g.outlet_count ?? 0), gap_strength: g.gap_strength ?? null, suggested_action: g.suggested_action ?? null }));
      const days = Math.max(7, PERIODS[scope.period].hours / 24);
      return {
        // the window is at least 7 days, whatever the console's period: the card says so
        scope: { ...scope, period: scope.period === "daily" ? "weekly" : scope.period }, asOf: i.now,
        data: { count: total, listed: rows.length, rows: rows.slice(0, 20), window_days: days },
        facts: [fact("gaps.count", `Incidents in the news with no department record, last ${days} days`, total),
          fact("gaps.listed", "Of them listed on the Briefing page (highest priority first)", rows.length)],
        sources: [fn("insights.insights", "news gaps"), tbl("incidents"), tbl("gaps"), tbl("documents")], incidentIds: rows.slice(0, 20).map((r) => r.id),
        testData: false, caveats: [NEWS_CAVEAT, ...(total > rows.length ? [`The Briefing page lists the ${rows.length} highest-priority of ${total}.`] : [])],
        untrusted: ["title", "suggested_action"]
      };
    }
  }),

  tool({
    name: "category_trends",
    description: "Incidents by category over time, as the Trends page: the top 6 categories plus all others, by week (the last 12 complete weeks) and by month (the last 6 months, current month partial). The scope's category filter does not narrow the lines.",
    args: scopeOnly,
    async run({ scope }) {
      const i = await ins(scope);
      const { weekly, monthly } = i.trends;
      const facts = [
        ...weekly.lines.flatMap((l) => [fact(`trend.week.${l.cat}.total`, `${l.label}, last 12 weeks`, l.total),
          fact(`trend.week.${l.cat}.last`, `${l.label}, week of ${weekly.keys[weekly.keys.length - 1]}`, l.values[l.values.length - 1])]),
        ...monthly.lines.map((l) => fact(`trend.month.${l.cat}.total`, `${l.label}, last 6 months`, l.total))
      ];
      const t = await testShare({ ...scope, period: "quarterly" }, i.now);
      // 12 complete weeks and 6 months, whatever the console's period
      return { scope: { ...scope, period: "quarterly", cat: null }, asOf: i.now, data: { weekly, monthly }, facts, sources: [fn("insights.insights", "trends"), tbl("incidents")], incidentIds: [],
        testData: t.testData, caveats: ["The current month is partial.", ...t.caveats] };
    }
  }),

  tool({
    name: "taluks",
    description: "The 17 revenue taluks in the district: unresolved (open), severe and past-deadline incidents over the last 30 days, and incidents reported against the 30 days before, as the Trends page's taluk ranking.",
    args: scopeOnly,
    async run({ scope }) {
      const [i, names] = await Promise.all([ins(scope), refNames()]);
      const rows = i.taluks.map((t) => ({ ...t, note: names.taluks.get(t.code)?.note ?? null }));
      const facts = rows.flatMap((r) => [fact(`taluk.${r.code}.open`, `Open incidents, ${r.name} taluk`, r.open), fact(`taluk.${r.code}.severe`, `Open severe, ${r.name}`, r.severe),
        fact(`taluk.${r.code}.overdue`, `Open past deadline, ${r.name}`, r.overdue), fact(`taluk.${r.code}.reported`, `Reported in 30 days, ${r.name}`, r.reported),
        fact(`taluk.${r.code}.prev`, `Reported in the 30 days before, ${r.name}`, r.prev)]);
      const notes = rows.filter((r) => r.note).map((r) => `${r.name}: ${r.note}.`);
      return { scope: { ...scope, period: "monthly", taluk: null }, asOf: i.now, data: { rows, window: "last 30 days vs the 30 days before" }, facts,
        sources: [fn("insights.insights", "taluks"), tbl("incidents"), tbl("ref_taluks")],
        incidentIds: [], testData: true, caveats: notes };
    }
  }),

  tool({
    name: "hotspots",
    description: "Hotspots: clusters of incidents close together (DBSCAN, 250 m) with at least 3 in the last 30 days, as the Trends page, with their category, size, open count, wards and the busiest place. For 'show hotspots on the map'.",
    args: scopeOnly,
    async run({ scope }) {
      const i = await ins(scope);
      const rows = i.patterns.hotspots.map((h) => ({ id: h.id, cat: h.cat, label: h.label, incidents: Number(h.incidents), incidents_30d: Number(h.incidents_30d),
        open: Number(h.open), lat: Number(h.lat), lon: Number(h.lon), wards: h.wards, top_place: h.top_place, zone: h.zone, zone_name: h.zone_name,
        first_seen: h.first_seen, last_seen: h.last_seen }));
      const facts = rows.flatMap((h) => [fact(`hotspot.${h.id}.incidents_30d`, `Incidents in 30 days, ${h.label} hotspot near ${h.top_place}`, h.incidents_30d),
        fact(`hotspot.${h.id}.open`, `Open, ${h.label} hotspot near ${h.top_place}`, h.open)]);
      // hotspots count the last 30 days, whatever the console's period
      return { scope: { ...scope, period: "monthly" }, asOf: i.now, data: { rows }, facts, sources: [fn("insights.insights", "hotspots"), tbl("hotspots")], incidentIds: [], testData: true,
        caveats: ["Hotspots are computed by the pipeline over all sources, including test data."] };
    }
  }),

  tool({
    name: "category_summary",
    description: "A summary of several subjects at once, part by part (\"road accidents, flooding and public-infrastructure complaints this week\"): for each part (a group of incident categories) the incidents reported in the period and the one before, open, severe, high, citizen complaints, and where they were concentrated (top zone and locality), plus each category inside a broad group.",
    args: z.object({ scope: ScopeSchema.default({}), parts: z.array(z.object({ label: z.string().min(2).max(60), codes: z.array(z.string().regex(/^[A-Z_]{3,40}$/)).min(1).max(12) })).min(1).max(6) }),
    llm: false,
    async run({ scope, parts }) {
      const now = await asOf();
      const figures = await categoryFigures(scope, now, [...new Set(parts.flatMap((p) => p.codes))]);
      const by = new Map(figures.map((f) => [f.code, f]));
      const top = (lists: { name: string; n: number }[][]) => {
        const sum = new Map<string, number>();
        for (const l of lists) for (const x of l) sum.set(x.name, (sum.get(x.name) ?? 0) + x.n);
        const best = [...sum.entries()].sort((a, b) => b[1] - a[1])[0];
        return best ? { name: best[0], n: best[1] } : null;
      };
      const rows = parts.map((p) => {
        const fs = p.codes.map((c) => by.get(c)).filter((f): f is NonNullable<typeof f> => !!f);
        const add = (k: "n" | "prev" | "open" | "severe" | "high" | "complaints" | "syn") => fs.reduce((a, f) => a + f[k], 0);
        const z = top(fs.map((f) => f.zones)), pl = top(fs.map((f) => f.places));
        const zoned = scope.zone != null;
        return { part: p.label, reported: add("n"), reported_prev: add("prev"), open: add("open"), severe: add("severe"), high: add("high"),
          complaints: add("complaints"), syn: add("syn"), top_zone: zoned ? null : z?.name ?? null, top_zone_n: zoned ? 0 : z?.n ?? 0, top_place: pl?.name ?? null, top_place_n: pl?.n ?? 0,
          categories: fs.map((f) => ({ part: p.label, category: f.label, reported: f.n, reported_prev: f.prev, open: f.open, severe: f.severe })) };
      });
      const syn = rows.reduce((a, r) => a + r.syn, 0), total = rows.reduce((a, r) => a + r.reported, 0);
      return {
        scope: { ...scope, cat: null }, asOf: now, data: { parts: rows, period: periodOf(scope) },
        facts: [fact("parts.count", "Subjects asked about", rows.length)],
        sources: [tbl("incidents", `categories: ${[...new Set(parts.flatMap((p) => p.codes))].join(", ")}`)],
        incidentIds: [], testData: syn > 0,
        caveats: [`${parts.map((p) => `${p.label}${p.codes.length > 1 ? ` (${p.codes.length} categories)` : ""}`).join("; ")}.`,
          ...(syn ? [syn === total ? `All ${inr(total)} incidents here come from test (synthetic) sources.` : `${inr(syn)} of ${inr(total)} incidents here come from test (synthetic) sources.`] : [])]
      };
    }
  }),

  tool({
    name: "place_breakdown",
    description: "Location-wise view of the incidents in the scope (a zone, a taluk, or a locality such as Velachery): how many by locality and by ward, the leading incident types there, and a map of the located incidents, highest priority first. For 'Adyar incidents', 'where in Zone 13', 'area wise', 'which parts of Velachery'.",
    args: z.object({ scope: ScopeSchema.default({}), place: z.string().trim().min(2).max(60).nullable().default(null) }),
    async run({ scope, place }) {
      const now = await asOf();
      // a place that is the scope's own zone or taluk is not a text filter: "Adyar" in Zone 13 is the whole zone
      const names = await refNames();
      const zoneName = scope.zone != null ? names.zones.get(scope.zone)?.name ?? null : null;
      const talukName = scope.taluk ? names.taluks.get(scope.taluk)?.name ?? null : null;
      const same = (a: string | null) => !!a && !!place && a.toLowerCase() === place.toLowerCase();
      const locality = place && !same(zoneName) && !same(talukName) ? place : null;
      const d = await placeBreakdown(scope, now, locality);
      const area = locality ?? talukName ?? zoneName ?? "the district";
      const facts = [
        fact("place.total", `Incidents reported in ${area}, ${periodOf(scope)}`, d.total.n), fact("place.open", `Of them still open`, d.total.open),
        fact("place.severe", `Of them severe`, d.total.severe), fact("place.high", `Of them high severity`, d.total.high),
        fact("place.localities", `Localities with incidents (up to 25 listed)`, d.localities.length), fact("place.wards", `Wards with incidents (up to 25 listed)`, d.wards.length),
        fact("place.mapped", `Incidents placed on the map (up to 400)`, d.points.length)
      ];
      const caveats: string[] = [];
      if (locality) caveats.push(`Incidents are matched to ${locality} by the place name in their records${zoneName ? `, within ${zoneName} zone` : ""}; an incident recorded under a street name alone is not counted.`);
      if (d.total.syn) caveats.push(d.total.syn === d.total.n ? `All ${inr(d.total.n)} incidents here come from test (synthetic) sources.` : `${inr(d.total.syn)} of ${inr(d.total.n)} incidents here come from test (synthetic) sources.`);
      return {
        scope, asOf: now, data: { area, locality, byStreet: !!locality, ...d }, facts,
        sources: [tbl("incidents", "place_text, ward_no, lat/lon"), tbl("ref_wards", "ward centroids")],
        incidentIds: d.points.slice(0, 30).map((p) => p.id), testData: d.total.syn > 0, caveats, untrusted: ["title", "place", "key"]
      };
    }
  }),

  tool({
    name: "unusual_rises",
    description: "Unusual rises in the last 21 days: a day, zone and category with far more reports than its usual level (Poisson baseline with a weekday factor, 28 days), as the Briefing page's 'Unusual rises'. Descriptive only, no forecast.",
    args: scopeOnly,
    async run({ scope }) {
      const i = await ins(scope);
      const rows = i.patterns.emerging.map((e) => ({ date: e.date, cat: e.cat, label: e.label, zone: e.zone == null ? null : Number(e.zone), zone_name: e.zone_name,
        observed: Number(e.observed), expected: round(Number(e.expected)), ratio: round(Number(e.ratio)), p_value: Number(e.p_value) }));
      const facts = rows.flatMap((e, k) => [fact(`rise.${k}.observed`, `${e.label}, ${e.zone_name ?? "district"}, ${e.date}: reports`, e.observed),
        fact(`rise.${k}.expected`, `${e.label}, ${e.zone_name ?? "district"}, ${e.date}: usual level`, e.expected),
        fact(`rise.${k}.ratio`, `${e.label}, ${e.zone_name ?? "district"}, ${e.date}: times the usual level`, e.ratio, "x")]);
      return { scope: null, asOf: i.now, data: { rows }, facts, sources: [fn("insights.insights", "unusual rises"), tbl("anomalies")], incidentIds: [], testData: true,
        caveats: ["Covers the last 21 days, whatever the console's period."] };
    }
  }),

  tool({
    name: "developing_stories",
    description: "Developing stories: news reports about the same event followed over several days (first report, arrests, deaths, court, action...), as the console's Developing stories, optionally about one place (a locality, zone or taluk name).",
    args: z.object({ scope: ScopeSchema.default({}), place: z.string().trim().min(2).max(60).nullable().default(null) }),
    async run({ scope, place }) {
      const now = await asOf();
      const r = await threads({ hours: PERIODS[scope.period].hours, zone: scope.zone, dept: scope.dept, cat: scope.cat, taluk: scope.taluk }, now);
      let list = r.threads;
      let resolved = null as Awaited<ReturnType<typeof resolvePlace>>;
      if (place) {
        resolved = await resolvePlace(place);
        const words = [place, resolved?.place].filter(Boolean).map((w) => String(w).toLowerCase());
        const areaLevel = !!resolved?.ward;
        list = list.filter((t) => {
          const text = [t.title, t.place ?? "", ...t.days.flatMap((d) => d.steps.map((x) => x.title))].join(" ").toLowerCase();
          if (words.some((w) => text.includes(w))) return true;
          if (!resolved || areaLevel) return false;
          return (resolved.zone != null && t.zones.includes(resolved.zone)) || (resolved.taluk != null && t.taluks.includes(resolved.taluk));
        });
      }
      const rows = list.slice(0, 12).map((t) => ({ id: t.id, title: t.title, place: t.place, category: t.catLabel, zones: t.zones, first: t.first, last: t.last,
        reports: t.reports, outlets: t.outlets, stages: t.stages.map((s) => s.stage), incidents: t.incidents, sev: t.sev, open: t.open,
        latest: { t: t.latest.t, title: t.latest.title, publisher: t.latest.publisher, url: t.latest.url } }));
      const facts = [fact("stories.count", "Developing stories found", list.length),
        ...rows.flatMap((t) => [fact(`story.${t.id}.reports`, `Reports in the story "${t.title.slice(0, 60)}"`, t.reports),
          fact(`story.${t.id}.outlets`, `Outlets covering it`, t.outlets.length)])];
      return {
        scope, asOf: now, data: { days: r.days, total: list.length, rows, place: resolved ? { ...resolved } : place ? { place, unresolved: true } : null }, facts,
        sources: [fn("threads.threads"), tbl("documents"), tbl("incidents")], incidentIds: rows.flatMap((t) => t.incidents).slice(0, 30), testData: false,
        caveats: [NEWS_CAVEAT, "English and Tamil reports of one event are not merged into one story yet."], untrusted: ["title", "latest"]
      };
    }
  }),

  tool({
    name: "contacts",
    description: "Officials in the GCC 'Who's who' directory for a department and/or a zone (the zone's zonal officer): name, designation and office. Phone numbers and emails are not given to the model.",
    args: z.object({ dept: z.string().regex(/^[A-Z0-9-]{2,20}$/).nullable().default(null), zone: z.number().int().min(1).max(15).nullable().default(null) }),
    async run({ dept, zone }) {
      const [rows, now] = await Promise.all([contactsFor(dept, zone), asOf()]);
      const out = rows.map((c) => ({ contact_id: Number(c.contact_id), group: c.grp, dept_code: c.dept_code ?? null, zone_no: c.zone_no == null ? null : Number(c.zone_no),
        name: c.name, designation: c.designation, office: c.office ?? null, source_url: c.source_url, retrieved_on: c.retrieved_on }));
      return { scope: null, asOf: now, data: { rows: out }, facts: [fact("contacts.count", "Officials found", out.length)],
        sources: [tbl("district_intel_ops.official_contacts", "GCC Who's who")], incidentIds: [], testData: false,
        caveats: out.length ? [] : ["No official in the directory matches; the GCC Who's who page does not list this department or zone."] };
    }
  }),

  tool({
    name: "environment",
    description: "Latest reading per station or facility for one measure, with its 28-day mean and z-score for comparison: air quality (aqi), rainfall_24h_mm, temperatures, humidity, IMD warning level, reservoir inflow, lake storage (lake_pct_full), hospital bed occupancy (bed_occupancy_pct) and other hospital measures. Optional 'above'/'below' thresholds. No forecasts.",
    args: z.object({
      metric: z.enum(Object.keys(ENV_METRICS) as [EnvMetric, ...EnvMetric[]]),
      above: z.number().nullable().default(null),
      below: z.number().nullable().default(null)
    }),
    async run({ metric, above, below }) {
      const now = await asOf();
      const m = ENV_METRICS[metric];
      const all = await envSignals(metric, now);
      const rows = all.filter((r) => (above == null || r.value > above) && (below == null || r.value < below));
      const warning = metric === "imd_warning_level" ? await warningToday(now) : null;
      const ageDays = (t: string) => (Date.parse(now.replace(" ", "T") + "+05:30") - Date.parse(t.replace(" ", "T") + "+05:30")) / 864e5;
      const stale = rows.filter((r) => ageDays(r.t) > 3);
      const facts = [
        ...(warning ? [] : [fact("env.places", `Places reporting ${m.label.toLowerCase()}`, all.length)]),
        ...(above != null || below != null ? [fact("env.matching", "Places meeting the threshold", rows.length)] : []),
        ...rows.slice(0, 40).flatMap((r) => [fact(`env.${r.place_id}.value`, `${m.label}, ${r.place}`, round(r.value), m.unit),
          ...(r.mean28 != null ? [fact(`env.${r.place_id}.mean28`, `28-day mean, ${r.place}`, round(r.mean28), m.unit)] : [])])
      ];
      if (warning) facts.push(fact("env.warning_level", `IMD warning level in force (0 green .. 3 red), issued ${warning.t.slice(0, 16)}`, warning.level));
      const caveats = [
        ...(m.test ? [`${m.source === "hospital" ? "Hospital" : "Lake"} readings are test (synthetic) data.`] : []),
        ...(stale.length ? [`${stale.length} of these readings are more than 3 days old.`] : []),
        ...(["aqi", "reservoir_inflow_cusec"].includes(metric) ? ["Station positions are approximate."] : []),
        ...(["aqi", "rainfall_24h_mm"].includes(metric) ? ["Rainfall and air-quality history is short: the collectors began recently."] : [])
      ];
      return {
        scope: null, asOf: now, data: { metric, label: m.label, unit: m.unit, above, below, rows, warning }, facts,
        sources: [tbl("observation_signals"), ...(warning ? [tbl("observations", "IMD warning text")] : [])], incidentIds: [], testData: m.test, caveats,
        untrusted: ["detail"]
      };
    }
  }),

  tool({
    name: "mandi_prices",
    description: "Vegetable and grocery prices at Chennai's markets reporting to AGMARKNET (Uzhavar Sandhai farmer markets: Anna Nagar, K.K. Nagar, Nanganallur, Ambattur and suburban ones): each market's latest modal price with its previous report, and the average across markets, plus the weekly regional trend. Koyambedu does not report to AGMARKNET.",
    args: z.object({ commodity: z.string().trim().min(2).max(40).nullable().default(null), market: z.string().trim().min(2).max(60).nullable().default(null) }),
    async run({ commodity, market }) {
      const [m, now] = await Promise.all([mandiMarkets(), asOf()]);
      const key = (s: string) => s.toLowerCase().replace(/uzhavar|sandhai|santhai|market|farmers?|\(.*?\)|[^a-z]/g, "");
      let marketKey: string | null = null;
      const caveats = ["Prices are AGMARKNET modal prices in rupees per quintal; per kg is the quintal price divided by 100."];
      // "Chennai", "all markets", "the city": every reporting market, not a market of that name
      const bare = (market ?? "").toLowerCase().replace(/\b(uzhavar|sandhai|santhai|markets?|in|at|the)\b/g, " ").trim();
      const citywide = !bare || /^(chennai|madras|city|all|any|every|district|gcc|local|nearby|today|tamil ?nadu|tn|சென்னை)$/.test(bare);
      if (market && !citywide) {
        const want = key(market);
        marketKey = CHENNAI_MARKETS.find((x) => key(x.key) === want || (want.length >= 4 && key(x.key).startsWith(want)))?.key
          ?? CHENNAI_MARKETS.find((x) => key(x.key) === closest(want, CHENNAI_MARKETS.map((y) => key(y.key))))?.key ?? null;
        // a market that does not report: say so, and show the ones that do rather than nothing
        if (!marketKey) caveats.unshift(/koyamb/.test(want) ? "Koyambedu, the wholesale market, does not report prices to AGMARKNET; these are the Chennai markets that do."
          : `${market} does not report prices to AGMARKNET; these are the Chennai markets that do.`);
      }
      // typos and local names: "tomatoe", "thakkali", "தக்காளி" -> Tomato; "tomato and onion" -> both
      const names = m.commodities.map((c) => c.commodity);
      const match = commodity ? matchCommodities(commodity, names) : { matched: [], unknown: [] };
      for (const u of match.unknown) caveats.unshift(`No ${u} price in the last 14 days of Chennai market reports (they cover ${names.length} items).`);
      let list = commodity ? m.commodities.filter((c) => match.matched.includes(c.commodity)) : m.commodities;
      if (marketKey && list.some((c) => c.prices[marketKey!])) list = list.filter((c) => c.prices[marketKey!]);
      else if (marketKey && list.length) {
        caveats.unshift(`${marketKey} has no recent report for ${list.map((c) => c.commodity).join(", ")}; these are the markets that do.`);
        marketKey = null;
      }
      const rows = list.slice(0, commodity ? 6 : 8).map((c) => {
        const prices = Object.entries(c.prices).filter(([k]) => !marketKey || k === marketKey)
          .map(([k, p]) => ({ market: k, date: p.date, per_quintal: p.price, per_kg: round(p.price / 100, 2), prev_per_kg: p.prev == null ? null : round(p.prev / 100, 2),
            prev_date: p.prevDate, low_per_kg: p.lo == null ? null : round(p.lo / 100, 2), high_per_kg: p.hi == null ? null : round(p.hi / 100, 2) }))
          .sort((a, b) => a.per_kg - b.per_kg);
        return { commodity: c.commodity, markets: prices.length, avg_per_kg: c.avg == null ? null : round(c.avg / 100, 2),
          avg_prev_per_kg: c.avgPrev == null ? null : round(c.avgPrev / 100, 2), prices };
      });
      const first = rows[0]?.commodity.toLowerCase().replace(/\(.*?\)/g, "").trim();
      const weekly = commodity && first ? (await mandiWeekly("chennai_region")).filter((w) => w.commodity.toLowerCase().startsWith(first)) : [];
      const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const facts = rows.flatMap((c) => [
        ...(c.avg_per_kg != null && !marketKey ? [fact(`mandi.${slug(c.commodity)}.avg_kg`, `${c.commodity}, average across ${c.markets} Chennai markets`, c.avg_per_kg, "Rs/kg")] : []),
        ...(c.avg_prev_per_kg != null && !marketKey ? [fact(`mandi.${slug(c.commodity)}.avg_kg.prev`, `${c.commodity}, average across the markets at their previous report`, c.avg_prev_per_kg, "Rs/kg")] : []),
        ...c.prices.flatMap((p) => [fact(`mandi.${slug(c.commodity)}.${slug(p.market)}.kg`, `${c.commodity} at ${p.market} on ${p.date}`, p.per_kg, "Rs/kg"),
          ...(p.prev_per_kg != null ? [fact(`mandi.${slug(c.commodity)}.${slug(p.market)}.prev_kg`, `${c.commodity} at ${p.market} on ${p.prev_date}`, p.prev_per_kg, "Rs/kg")] : [])])
      ]);
      if (m.latest) caveats.unshift(`Latest market report: ${m.latest} (markets report to AGMARKNET a few days late), not today.`);
      return {
        scope: null, asOf: now, data: { found: rows.length > 0, market: marketKey, latest: m.latest, fetched: m.fetched, rows, weekly, unknown: match.unknown }, facts,
        sources: [fn("sources.mandiMarkets"), tbl("district_intel_ops.mandi_market_prices"), ...(weekly.length ? [tbl("district_intel_ops.mandi_weekly")] : [])],
        incidentIds: [], testData: false, caveats
      };
    }
  }),

  tool({
    name: "source_health",
    description: "Freshness of every data source: the pipeline's feeds (complaints, police, PWD, hospitals, news, IMD, CPCB, CFM) with status and minutes since the last success, the time the store was last exported, and the sources the Collector added (AGMARKNET, OCR, RSS...).",
    args: z.object({}),
    async run() {
      const [f, sources, now] = await Promise.all([feeds(), addedSources(), asOf()]);
      const ok = f.rows.filter((r) => r.status === "ok").length;
      const facts = [fact("feeds.ok", "Feeds healthy", ok), fact("feeds.total", "Feeds", f.rows.length),
        ...f.rows.map((r) => fact(`feed.${r.source}.minutes`, `Minutes since ${r.source} last succeeded (before the build)`, r.minutes_since_success ?? 0, "minutes"))];
      return { scope: null, asOf: now, data: { feeds: f.rows, exportedAt: f.exportedAt, sources }, facts, sources: [tbl("source_health"), tbl("_export_meta"), tbl("district_intel_ops.sources")],
        incidentIds: [], testData: false, caveats: ok < f.rows.length ? [`${f.rows.length - ok} of ${f.rows.length} feeds are not up to date.`] : [] };
    }
  }),

  tool({
    name: "resolve_place",
    description: "Turn a place name in English or Tamil (a locality, GCC area, zone or taluk) into its ward, zone and taluk, from the news monitor's gazetteer and the GCC area list. Also reports a revenue taluk named in the text (some names, such as Kolathur, are both a locality and a taluk).",
    args: z.object({ text: z.string().trim().min(2).max(120) }),
    async run({ text }) {
      const [p, names, now] = await Promise.all([resolvePlace(text), refNames(), asOf()]);
      const taluk = p?.taluk ? names.taluks.get(p.taluk) : null;
      // The resolver prefers the most specific place, so "Kolathur" becomes the locality in Ayanavaram taluk;
      // a taluk named in the text is reported as well, with its note (Kolathur taluk is not coded by the sources).
      const lower = text.toLowerCase();
      const hit = [...names.taluks.entries()].find(([, t]) => new RegExp(`\\b${t.name.toLowerCase()}\\b`).test(lower) ||
        (!!t.nameTa && text.includes(t.nameTa.replace(/்$/, ""))));
      const named = hit ? { code: hit[0], name: hit[1].name, in_district: hit[1].inDistrict, note: hit[1].note } : null;
      const data = p || named ? {
        ...(p ?? {}), zone_name: p?.zone ? names.zones.get(p.zone)?.name ?? null : null, taluk_name: taluk?.name ?? null, taluk_note: taluk?.note ?? null,
        taluk_named: named, asked_for_taluk: /\btaluk|வட்ட/i.test(text)
      } : null;
      const notes = [...new Map([taluk, named].filter((t) => t?.note).map((t) => [t!.name, `${t!.name} taluk: ${t!.note}.`])).values()];
      return { scope: null, asOf: now, data, facts: [], sources: [fn("nlp.resolvePlace", "gazetteer"), tbl("ref_taluks")], incidentIds: [], testData: false,
        caveats: [...(p || named ? [] : [`No district place found in "${text}".`]), ...notes] };
    }
  }),

  tool({
    name: "incident_series",
    description: "Incidents reported in the scope over time, in the console's buckets (2-hour buckets for the last 24 hours, daily for a week or 30 days, weekly for 90 days), with severe and still-open counts per bucket. For trend lines such as 'road accident trend for the last 30 days' (monthly scope, category ROAD_ACCIDENT).",
    args: scopeOnly,
    async run({ scope }) {
      const now = await asOf();
      const [buckets, normal] = await Promise.all([incidentSeries(scope, now), seriesNormal(scope, now)]);
      const total = buckets.reduce((a, b) => a + b.n, 0);
      const unit = PERIODS[scope.period].buckets === 12 ? "2 hours" : scope.period === "quarterly" ? "week" : "day";
      const facts = [fact("series.total", `Incidents reported, ${periodOf(scope)}`, total),
        ...buckets.map((b, k) => fact(`series.${k}.n`, `Incidents reported ${b.from.slice(0, 16)} to ${b.to.slice(0, 16)}`, b.n)),
        fact("series.max", "Most in one bucket", Math.max(0, ...buckets.map((b) => b.n))),
        fact("series.min", "Fewest in one bucket", Math.min(...buckets.map((b) => b.n))),
        fact("series.mean", `Average per ${unit}`, round(total / Math.max(1, buckets.length)))];
      if (normal) facts.push(fact("series.normal_lo", `Usual low per ${unit} (10th percentile of the ${normal.n} ${unit}s before)`, normal.lo),
        fact("series.normal_hi", `Usual high per ${unit} (90th percentile)`, normal.hi), fact("series.normal_mean", `Usual average per ${unit}`, normal.mean));
      const t = await testShare(scope, now);
      const above = normal ? buckets.filter((b) => b.n > normal.hi).length : 0;
      if (normal) facts.push(fact("series.above_normal", `${unit}s above the usual range`, above));
      return { scope, asOf: now, data: { buckets, unit, normal }, facts: [...facts, ...t.facts], sources: [fn("intel.scopeWhere"), tbl("incidents")], incidentIds: [],
        testData: t.testData, caveats: [...t.caveats, ...(normal ? [`The usual range is the 10th-90th percentile of the ${normal.n} ${unit}s before this period; it describes history, it is not a forecast.`] : [])] };
    }
  }),

  tool({
    name: "map_geo",
    description: "Ward polygons, zone outlines and taluk centres for drawing maps (not for answering).",
    llm: false,
    args: z.object({}),
    async run() {
      const [g, now] = await Promise.all([mapGeo(), asOf()]);
      return { scope: null, asOf: now, data: g, facts: [], sources: [fn("geo.mapGeo"), tbl("ref_wards"), tbl("ref_zones")], incidentIds: [], testData: false,
        caveats: ["Ward boundaries come from the DataMeet community dataset, not an official GCC publication."] };
    }
  })
];

// ------------------------------------------------------------------ registry --

const BY_NAME = new Map<string, ToolDef<z.ZodTypeAny>>(TOOLS.map((t) => [t.name, t as unknown as ToolDef<z.ZodTypeAny>]));

export type ToolName = (typeof TOOLS)[number]["name"];

/** Name, description and argument names of every tool, for prompts and the developer route. */
export function listTools(opts: { llmOnly?: boolean } = {}) {
  return TOOLS.filter((t) => !opts.llmOnly || t.llm !== false).map((t) => ({
    name: t.name, description: t.description, llm: t.llm !== false,
    args: Object.keys((t.args as unknown as z.AnyZodObject).shape ?? {})
  }));
}

/** Validate the arguments and run one tool. Throws ToolError for an unknown tool or bad arguments. */
export async function runTool(name: string, raw: unknown): Promise<ToolResult> {
  const t = BY_NAME.get(name);
  if (!t) throw new ToolError(`Unknown tool: ${name}`);
  const parsed = t.args.safeParse(raw ?? {});
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new ToolError(`Invalid arguments for ${name}: ${i ? `${i.path.join(".") || "(root)"} ${i.message}` : "check the input"}`);
  }
  const args = parsed.data as Record<string, unknown>;
  if (args.scope) {
    const problems = scopeProblems(args.scope as AssistantScope, await refNames());
    if (problems.length) throw new ToolError(problems.join(" "));
  }
  const body = await t.run(args);
  return { tool: name, args, ...body };
}
