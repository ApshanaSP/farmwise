/**
 * One question, start to finish:
 *
 *   code guard -> router (fast model; rules when no model is available)
 *     -> tools (the console's functions) | query plan -> compiler -> read-only SQL | console action | chart edit
 *     -> facts (code) -> composer (reasoning model) -> number verifier (regenerate once, then a template)
 *     -> chart checker -> answer card -> saved with its plan, audited.
 *
 * At most three model calls per question (router, planner, composer), plus one composer retry
 * when the verifier rejects numbers. When the provider is busy or missing, the answer still
 * comes from the tools, written by a template, and says so.
 */
import { AiBudgetError, AiBusyError, AiUnavailableError, aiStatus, generateJson, type CallInfo } from "@/lib/ai/gateway";
import { routerPrompt, routerSchemas, routerSystem } from "@/lib/ai/prompts/router";
import { PLANNER_SYSTEM, plannerPrompt } from "@/lib/ai/prompts/planner";
import { ComposerLenient, ComposerSchema, composerPrompt, composerSystem, type ComposerOutput } from "@/lib/ai/prompts/composer";
import { asOf as storeAsOf } from "@/lib/collector/intel";
import { classify } from "@/lib/collector/nlp";
import { audit } from "@/lib/collector/sources";
import { EXAMPLES, TEXT, detectLanguage, hasTamilScript, requestedCount, wantsNoVisual, wantsTable, wantsVisual, wantsVisualByNature, type Lang, type LangChoice } from "@/lib/assistant/lang";
import { ScopeSchema, describeScope, fmtAsOf, refNames, type RefNames } from "@/lib/assistant/scope";
import { ToolError, listTools, runTool } from "@/lib/assistant/tools";
import { ENV_METRICS } from "@/lib/assistant/queries";
import { applyTopN, presentAll, spec, type Presentation } from "@/lib/assistant/datasets";
import { correctSpelling } from "@/lib/assistant/spell";
import { multiPart } from "@/lib/assistant/parts";
import { warmUp } from "@/lib/assistant/embed";
import { buildFacts, factLines, slug } from "@/lib/assistant/facts";
import { contextNumbers, extractNumbers, verifyNumbers } from "@/lib/assistant/verify";
import { allowedTypes, checkChart } from "@/lib/assistant/chartspec";
import { codeGuard, offlineRoute } from "@/lib/assistant/guard";
import { loadCatalog, renderCatalog } from "@/lib/assistant/catalog";
import { CompileError, PlanSchema, compileQuery, runCompiled, type QueryPlan, type QueryResult } from "@/lib/assistant/compile";
import { helpFor, isHelpQuestion } from "@/lib/assistant/help";
import { insightByKey } from "@/lib/assistant/insightcards";
import { editFromText, isBareEdit } from "@/lib/assistant/edits";
import { actionCard, baseCard, clarifyCard, errorCard, notYetCard, refusalCard, smalltalkCard, templateCard, validActions } from "@/lib/assistant/cards";
import { addMessage, ensureSession, getPin, lastCardWithData, messagePayload, recentTurns } from "@/lib/assistant/store";
import { LIMITS, forModel } from "@/lib/assistant/limits";
import type { AnswerCard, ChartSpec, ChartType, ConsoleAction, DataRow, Dataset, Field, Scope } from "@/lib/assistant/answer";
import type { Fact, ToolResult } from "@/lib/assistant/types";

type Row = Record<string, any>;
export type Stage = "understanding" | "fetching" | "drawing";

export interface ChatInput {
  user: string;
  sessionId: string | null;
  message: string;
  inputMode: "text" | "voice";
  language: LangChoice;
  scope: Scope;
  /** the answer a follow-up refers to (the dialog sends its last answer's id) */
  replyTo: string | null;
  /** a pinned answer to run again on the latest data */
  pinId?: number | null;
  /** one of today's insights to open as a card */
  insightKey?: string | null;
  /** a department officer's console: every answer is for this department only (from the database, never the request) */
  lockDept?: string | null;
  signal?: AbortSignal;
  stage: (s: Stage) => void;
}
export interface ChatOutput { card: AnswerCard; sessionId: string; messageId: string }

interface Route {
  intent: string;
  language: Lang | null;
  normalized: string;
  scope: Scope;
  /** what the router changed in the scope (a follow-up applies it to the previous answer's scope, not the console's) */
  scopeRaw: Row;
  tools: { name: string; args: Record<string, unknown> }[];
  chartEdit: { type: ChartType | null; showOnMap: boolean } | null;
  actions: Partial<ConsoleAction>[];
  clarify: string | null;
  refusal: string | null;
  assumptions: string[];
  offline: boolean;
  /** the router read the message as asking for a picture (chart, graph, map), in whatever words */
  visual?: boolean;
}

// ------------------------------------------------------------------ caches --

const cache = new Map<string, { at: number; value: unknown }>();
function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > 10 * 60_000) return null;
  return hit.value as T;
}
function remember(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
}
const scopeKey = (s: Scope) => `${s.period}|${s.zone ?? ""}|${s.dept ?? ""}|${s.cat ?? ""}|${s.taluk ?? ""}`;

// ------------------------------------------------------------------- route --

const TOOL_ARGS: Record<string, (c: Row, s: Scope) => Record<string, unknown>> = {
  zone_profile: (c, s) => ({ scope: s, zone: c.zone ?? s.zone ?? 1 }),
  incidents: (c, s) => ({ scope: s, sev: c.sev ?? null, status: c.status ?? null, q: c.q ?? null, allTime: !!c.allTime }),
  incident_detail: (c) => ({ id: c.id ?? "" }),
  incident_story: (c, s) => ({ text: c.text ?? c.q ?? c.id ?? "", scope: s }),
  search: (c) => ({ text: c.text ?? c.q ?? c.place ?? "" }),
  developing_stories: (c, s) => ({ scope: s, place: c.place ?? null }),
  place_breakdown: (c, s) => ({ scope: s, place: c.place ?? null }),
  contacts: (c, s) => ({ dept: c.dept ?? s.dept, zone: c.zone ?? s.zone }),
  environment: (c) => ({ metric: c.metric ?? "aqi", above: c.above ?? null, below: c.below ?? null }),
  mandi_prices: (c) => ({ commodity: c.commodity ?? null, market: c.market ?? null }),
  resolve_place: (c) => ({ text: c.text ?? c.place ?? "" }),
  source_health: () => ({}),
  map_geo: () => ({})
};
const toolArgs = (name: string, c: Row, s: Scope) => (TOOL_ARGS[name] ?? ((_: Row, sc: Scope) => ({ scope: sc })))(c, s);
// ------------------------------------------------------- department lock --

/** Tools that rank every department side by side: not on a department officer's console. */
const ALL_DEPTS = new Set(["departments", "dept_backlog"]);
const OWN_DEPT_NOTE = "Answered for your department only: a department console does not show other departments' figures.";

/**
 * A department officer's tools: each runs with their department as its filter, a ranking of all departments becomes the
 * department's own headline figures, a text search becomes a search of the department's incidents, and contacts are
 * the department's.
 */
function lockTools(tools: { name: string; args: Record<string, unknown> }[], dept: string, base: Scope, notes: string[]) {
  const out: { name: string; args: Record<string, unknown> }[] = [];
  for (const t of tools) {
    const scope = { ...((t.args.scope as Scope | undefined) ?? base), dept };
    if (ALL_DEPTS.has(t.name)) {
      notes.push(OWN_DEPT_NOTE);
      if (!out.some((x) => x.name === "overview_kpis")) out.push({ name: "overview_kpis", args: { scope } });
    } else if (t.name === "search") {
      out.push({ name: "incidents", args: { scope, sev: null, status: null, q: String(t.args.text ?? "").slice(0, 80) || null, allTime: true } });
    } else if (t.name === "contacts") {
      out.push({ ...t, args: { ...t.args, dept } });
    } else {
      out.push(t.args.scope ? { ...t, args: { ...t.args, scope } } : t);
    }
  }
  return out;
}

/** An incident another department handles is not opened from a department console. */
function otherDeptsIncident(r: ToolResult, dept: string): boolean {
  if (r.tool !== "incident_detail" && r.tool !== "incident_story") return false;
  const d = (r.data as Row | null)?.incident?.dept;
  return !!d && d !== dept;
}

/** The planner's query keeps the officer's department: filters and groupings on department columns are dropped, so the scope applies. */
function lockQuery<T extends { filters: { field: string }[]; dimensions: { field: string }[] }>(q: T): T {
  const isDept = (f: string) => /(^|\.)(lead_dept|dept_code|department)$/.test(f);
  return { ...q, filters: q.filters.filter((f) => !isDept(f.field)), dimensions: q.dimensions.filter((d) => !isDept(d.field)) };
}

const SMALLTALK = /^\s*(hi|hello|hey|thanks|thank you|thx|good (morning|afternoon|evening|night)|vanakkam|nandri|ok|okay|bye)\b|^\s*(வணக்கம்|நன்றி)/i;
/** A message that names a period (a follow-up without one keeps the previous answer's). */
const PERIOD_WORDS = /\b(today|yesterday|daily|day|days|week|weekly|month|monthly|quarter|quarterly|hours?|24 ?h|year|since)\b|இன்று|நேற்று|வார|மாத|காலாண்டு|innaiki|indha vaaram|maasam|vaaram/i;
/** A question about one specific incident ("what is this murder case", "tell me about the fire at", "Adyar murder enna aachu"). */
const STORY = /\b(what (is|was|are) (this|that|the)|tell me (more )?about|explain|details? (of|about|on)|what happened|story of|about (this|that|the) (case|incident)|update on (the|this|that))\b|enna (aachu|nadandhuchu|nadanthuchu|case)|\b(case|incident|murder|accident|fire|kolai)\s+(enna|yenna|pathi|patthi)\b|என்ன நடந்தது|(வழக்கு|சம்பவம்|கொலை|விபத்து)\s*(என்ன|பற்றி)|பற்றி (சொல்|விளக்கு)/i;
const STORY_THING = /\b(case|incident|murder|killing|killed|accident|crash|fire|blaze|theft|robbery|snatching|burglary|collapse|death|died|attack|assault|stabbing|drowning|drowned|missing|explosion|clash|protest)\b|INC-[A-Z0-9]|கொலை|விபத்து|தீ விபத்து|வழக்கு/i;

/**
 * A follow-up that only changes where or when ("only Adyar zone", "what about last month?", "same for Zone 9", "for the whole
 * district"): short, opens like a follow-up, and names no new subject.
 */
function isRefinement(m: string, namesPlace: boolean): boolean {
  if (m.length > 60 || multiPart(m) || STORY.test(m)) return false;
  const lead = /^\s*(only|just|what about|how about|and|same (for|in)|now (for|in|show)|for|in|then|also)\b|^\s*(இப்போ|மட்டும்)|\b(mattum|ku mattum)\s*$/i.test(m);
  const where = namesPlace || /\bzone\s*\d{1,2}\b|whole district|district[- ]wide|all zones|\btaluk\b/i.test(m) || PERIOD_WORDS.test(m);
  const subject = /\b(price|rate|lake|reservoir|hospital|bed|aqi|air|rain|weather|warning|officer|contact|stor(y|ies)|news|briefing)\b/i.test(m);
  return lead && where && !subject;
}

/**
 * Whether the answer is drawn. Asked for ("as a chart", "visualise", "on the map"): always. "In words" / "no chart": never.
 * Otherwise by the question's nature: a ranking ("top 3 worst"), a comparison, a breakdown ("by zone"), a trend, where
 * things are, or several subjects side by side are drawn; one incident's story, a list of records, a single fact or a
 * count are words (and a table for a list). `routerSays`: the router read a picture into other words.
 */
function needsPicture(question: string, results: ToolResult[], routerSays: boolean): boolean {
  if (wantsNoVisual(question)) return false;
  if (wantsVisual(question)) return true;
  const story = results.some((r) => r.tool === "incident_story" || r.tool === "incident_detail");
  const severalParts = (((results.find((r) => r.tool === "category_summary")?.data as Row | undefined)?.parts as Row[] | undefined)?.length ?? 0) >= 2;
  return !story && !wantsTable(question) && (wantsVisualByNature(question) || severalParts || routerSays);
}

/** Tools whose rule match is specific enough to beat the planner. */
const PREFER_TOOL = new Set(["departments", "zones", "dept_backlog", "verification_queue", "environment", "mandi_prices", "hotspots", "news_gaps",
  "developing_stories", "source_health", "taluks", "incident_series", "place_breakdown"]);

function applyScope(base: Scope, r: Row, n: RefNames): Scope {
  const s: Scope = { ...base };
  if (r.period) s.period = r.period;
  for (const k of (r.clear ?? []) as (keyof Scope)[]) (s as Row)[k] = null;
  if (r.zone != null && n.zones.has(Number(r.zone))) s.zone = Number(r.zone);
  if (r.dept && n.depts.has(r.dept)) s.dept = r.dept;
  if (r.cat && n.cats.has(r.cat)) s.cat = r.cat;
  if (r.taluk && n.taluks.has(r.taluk)) s.taluk = r.taluk;
  return s;
}

function codes(n: RefNames): string {
  const z = [...n.zones.entries()].map(([k, v]) => `${k} ${v.name}`).join(", ");
  const d = [...n.depts.entries()].filter(([, v]) => v.actionOwner).map(([k, v]) => `${k} ${v.name}`).join(", ");
  const c = [...n.cats.entries()].map(([k, v]) => `${k} ${v.label}`).join(", ");
  const t = [...n.taluks.entries()].map(([k, v]) => `${k} ${v.name}${v.note ? ` (${v.note})` : ""}`).join(", ");
  return `Zones: ${z}\nDepartments: ${d}\nCategories: ${c}\nTaluks: ${t}\nMetrics: ${Object.keys(ENV_METRICS).join(", ")}`;
}

/** One line per tool for the router (the full descriptions are for the tools' own documentation): keeps the router's prompt small. */
const BRIEF: Record<string, string> = {
  overview_kpis: "headline figures: severe, open complaints, ongoing, resolved, with the previous period",
  zones: "all zones ranked by attention score (3 x severe + high), with severe, open, open complaints; zone rankings and zone maps",
  zone_profile: "one zone in depth (zone): its rank, top open incidents with reasons, zonal officer",
  departments: "departments: open, reported, severe, awaiting verification",
  severity: "open incidents by severity, severity mix, top open incidents",
  verification_queue: "citizen complaints awaiting the Collector's verification",
  dept_backlog: "slowest departments by average age of open incidents",
  incidents: "list incidents (sev; status open|awaiting|unverified|verified|critical; q keyword; allTime)",
  incident_detail: "one incident by id (INC-...)",
  incident_story: "explain ONE specific incident described in words (text = the description: 'the murder case in Adyar', 'fire in Guindy yesterday'): what happened, when, status, reports",
  search: "find zones, departments or incidents by text",
  briefing: "the Collector's briefing for the period",
  dept_followups: "per department: overdue and serious incidents, next steps",
  news_gaps: "incidents in the news with no department record",
  category_trends: "weekly and monthly counts by category",
  taluks: "revenue taluks: open, severe, overdue; 30 days against the 30 before",
  hotspots: "clusters of incidents, for the map",
  place_breakdown: "location-wise: incidents by locality, ward and type in the scope's zone or taluk, or one locality (place), with a map",
  unusual_rises: "days with far more reports than usual (last 21 days)",
  developing_stories: "news stories followed over days (place optional)",
  contacts: "officials for a department (dept) and/or zone (zone), from the GCC directory",
  environment: "latest reading per place for one metric (metric; above/below): air quality, rain, temperature, IMD warning, lakes, hospital beds",
  mandi_prices: "vegetable and fruit prices at Chennai markets (commodity: one or more names, comma-separated; market: only a market the message names, never \"Chennai\"); Koyambedu does not report",
  source_health: "freshness of the data feeds",
  resolve_place: "place name to ward, zone and taluk",
  incident_series: "incidents over time in the scope, with the usual range (trend lines)"
};

function summaryOf(turns: Row[]): string {
  return turns.slice(-8).map((t) => {
    if (t.role === "user") return `Collector: ${String(t.content_text ?? "").slice(0, 200)}`;
    const tools = (t.plan?.tools ?? []).map((x: Row) => `${x.name}(${JSON.stringify(x.args?.scope ?? x.args ?? {})})`).join(", ");
    const chart = t.chart ? `${t.chart.type} of ${t.chart.y?.join(",")} in ${t.chart.dataset}` : String(t.display ?? "text");
    return `Assistant: ${String(t.headline ?? "").slice(0, 160)} [intent ${t.plan?.intent ?? "?"}; tools ${tools || "none"}; shown as ${chart}]`;
  }).join("\n");
}

/** The conversation for the composer: who said what, without the router's bookkeeping (a small model copies it into the answer). */
function plainSummary(turns: Row[]): string {
  return turns.slice(-4).map((t) => (t.role === "user" ? `Collector: ${String(t.content_text ?? "").slice(0, 200)}` : `Assistant: ${String(t.headline ?? "").slice(0, 160)}`)).join("\n");
}

async function llmRoute(i: ChatInput, message: string, detected: string, base: Scope, n: RefNames, turns: Row[], place: string, now: string,
  models: CallInfo[]): Promise<Route> {
  const tools = listTools({ llmOnly: true });
  const schemas = routerSchemas(tools.map((t) => t.name) as [string, ...string[]], Object.keys(ENV_METRICS) as [string, ...string[]]);
  const hint = classify(message);
  const category = hint && hint.conf >= 0.6 ? `${hint.code} (${hint.label})` : "";
  // the tool list and codes sit in the system prompt: the same for every question, so read from the prompt cache after the first
  const system = routerSystem(tools.map((t) => `${t.name}(${t.args.join(", ")}): ${BRIEF[t.name] ?? t.description}`).join("\n"), codes(n));
  const r = await generateJson({
    role: "fast", name: "router", schema: schemas.strict, lenient: schemas.lenient, system, temperature: 0, maxOutputTokens: 1400, user: i.user,
    abortSignal: i.signal,
    prompt: routerPrompt({ message, detected, scopeLine: describeScope(base, n, "en"), scopeJson: JSON.stringify(base), summary: summaryOf(turns), place, category, asOf: now,
      typed: i.message.replace(/\s+/g, " ").trim() !== message ? i.message.replace(/\s+/g, " ").trim().slice(0, LIMITS.messageChars) : undefined })
  });
  models.push(r.info);
  const o = r.object;
  const scope = applyScope(base, o.scope, n);
  // a small model sometimes fills in a zone or taluk nobody named ("Top five departments" read as Zone 1): keep one only
  // when the message, the resolved place or the conversation names it
  const placed = place ? (JSON.parse(place) as Row) : null;
  // the conversation counts only for a follow-up, or a question that points back ("there", "same zone"); a new question
  // does not inherit the last answer's zone
  const backRef = o.intent === "plan_edit" || /\b(there|that (zone|area|place|taluk)|same (zone|area|place|taluk)|this (zone|area)|over there)\b|அங்கே|அங்கு|anga\b/i.test(message);
  const talk = `${message} ${backRef ? turns.slice(-4).map((t) => `${t.content_text ?? ""} ${JSON.stringify(t.plan?.tools ?? [])}`).join(" ") : ""}`.toLowerCase();
  if (scope.zone != null && scope.zone !== base.zone) {
    const z = n.zones.get(scope.zone);
    const named = new RegExp(`\\bzone\\s*-?\\s*0?${scope.zone}\\b|மண்டலம்\\s*${scope.zone}\\b|"zone":${scope.zone}\\b`, "i").test(talk)
      || (!!z?.name && talk.includes(z.name.toLowerCase())) || (!!z?.nameTa && talk.includes(z.nameTa)) || Number(placed?.zone) === scope.zone;
    if (!named) { o.assumptions.push(`Zone ${scope.zone} was not named in the question, so the answer covers ${base.zone ? `Zone ${base.zone}` : "the whole district"}.`); scope.zone = base.zone; o.scope.zone = null; }
  }
  if (scope.taluk && scope.taluk !== base.taluk) {
    const t = n.taluks.get(scope.taluk);
    const named = talk.includes(scope.taluk.toLowerCase()) || (!!t?.name && talk.includes(t.name.toLowerCase())) || (!!t?.nameTa && talk.includes(t.nameTa))
      || placed?.taluk === scope.taluk || (placed?.taluk_named as Row | null)?.code === scope.taluk;
    if (!named) { scope.taluk = base.taluk; o.scope.taluk = null; }
  }
  // a department filter only when the question (or, for a follow-up, the conversation) names it: "public infrastructure
  // complaints" is not "Parks & Play Fields"
  if (scope.dept && scope.dept !== base.dept) {
    const d = n.depts.get(scope.dept);
    const words = `${d?.name ?? ""} ${scope.dept}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !["and", "the", "department", "dept", "gcc", "wing"].includes(w));
    if (!words.some((w) => new RegExp(`\\b${w}`, "i").test(talk))) { scope.dept = base.dept; o.scope.dept = null; }
  }
  // A category the question names must narrow the data, or the answer would claim it without covering it.
  if (!scope.cat && category && hint && o.intent === "tool_question" && !/\b(categor|by type|each type|vs\.?|versus|compare)/i.test(message)) {
    scope.cat = hint.code;
    o.assumptions.push(`Narrowed to ${hint.label} (named in the question).`);
  }
  return {
    intent: o.intent, language: o.language, normalized: o.normalizedQuestion || message, scope, scopeRaw: o.scope,
    tools: o.tools.slice(0, LIMITS.queriesPerQuestion).map((c) => ({ name: c.name, args: toolArgs(c.name, c, scope) })),
    chartEdit: o.chartEdit, actions: o.consoleActions, clarify: o.needsClarification ? o.clarificationQuestion : null, refusal: o.refusalReason,
    assumptions: o.assumptions, offline: false, visual: o.visual
  };
}

/**
 * A locality the resolver placed (Velachery: zone 13, Velachery taluk) narrows the tools' scope, and a keyword that only
 * repeats its name is dropped. The taluk is added unless its code is known to be missing from some sources (its note).
 */
function placeAsScope(route: Route, p: Row, n: RefNames): Route {
  const name = String(p.place ?? "").toLowerCase();
  const named = p.taluk_named as Row | null;
  const askedTaluk = p.asked_for_taluk && named?.code && n.taluks.has(named.code) ? String(named.code) : null;
  let moved = false;
  let matched: string | null = null;
  const tools = route.tools.map((t) => {
    const s = t.args.scope as Scope | undefined;
    // a location-wise view of a locality: its zone, and the locality matched by place name (a taluk would be wider than the locality)
    if (t.name === "place_breakdown" && s && !askedTaluk && p.zone != null && (s.zone == null || s.zone === Number(p.zone))) {
      const zoneName = n.zones.get(Number(p.zone))?.name?.toLowerCase() ?? "";
      const place = (t.args.place as string | null) ?? (name && name !== zoneName ? String(p.place) : null);
      if (s.zone === Number(p.zone) && !s.taluk && place === t.args.place) return t;
      moved = true;
      if (place) matched = place;
      return { ...t, args: { ...t.args, place, scope: { ...s, zone: Number(p.zone), taluk: null } } };
    }
    // rankings across zones or taluks, and a zone's own profile, are not narrowed
    if (!s || s.zone != null || s.taluk || ["zones", "taluks", "zone_profile"].includes(t.name) || (!askedTaluk && p.zone == null)) return t;
    const q = typeof t.args.q === "string" ? t.args.q : null;
    const sameAsPlace = !!q && !!name && (q.toLowerCase().includes(name) || name.includes(q.toLowerCase()));
    moved = true;
    // "Kolathur taluk": the taluk the text names, not the locality's zone
    if (askedTaluk) return { ...t, args: { ...t.args, ...(sameAsPlace ? { q: null } : {}), scope: { ...s, zone: null, taluk: askedTaluk } } };
    // "Kolathur" is a locality (in Ayanavaram taluk) and a taluk of its own: naming another taluk than the locality's would mislead
    const otherTalukNamed = !!named && named.code !== p.taluk;
    const taluk = p.taluk && !otherTalukNamed && n.taluks.has(p.taluk) && !n.taluks.get(p.taluk)?.note ? String(p.taluk) : null;
    return { ...t, args: { ...t.args, ...(sameAsPlace ? { q: null } : {}), scope: { ...s, zone: Number(p.zone), taluk } } };
  });
  if (!moved) return route;
  const s = tools.find((t) => t.args.scope)?.args.scope as Scope;
  const note = askedTaluk ? `${named!.name} taluk.${named!.note ? ` ${named!.note}.` : ""}`
    : matched ? `${matched}: incidents whose place names it, within ${n.zones.get(Number(p.zone))?.name ?? `Zone ${p.zone}`} zone.`
      : `${p.place} read as its zone${s.taluk ? " and taluk" : ""}.`;
  return { ...route, tools, scope: s, assumptions: [...route.assumptions, note,
    ...(!askedTaluk && named && named.code !== p.taluk ? [`${named.name} is also a revenue taluk${named.note ? ` (${named.note})` : ""}; ask for "${named.name} taluk" to see it.`] : [])] };
}

function rulesRoute(message: string, base: Scope, n: RefNames, hasPlace = false): Route {
  const o = offlineRoute(message, n);
  const scope = o.period ? { ...base, period: o.period } : { ...base };
  const zn = Number(message.match(/\bzone\s*-?\s*(\d{1,2})\b/i)?.[1]);
  if (zn && n.zones.has(zn)) scope.zone = zn;
  // a category named in the question ("road accident trend"), by the console's own keyword classifier
  const cat = classify(message);
  if (cat && cat.conf >= 0.6 && n.cats.has(cat.code)) scope.cat = cat.code;
  // no rule matched, but the question names a category or a place ("Velachery la indha week evlo accidents?"): its incidents
  // ("Adyar incidents" with no count asked: where they are, location-wise)
  if (o.intent === "unknown" && (scope.cat !== base.cat || hasPlace)) {
    o.intent = "tool_question";
    const count = /how many|evlo|evvalo|evvalavu|count|number of|\blist\b|எத்தனை|எவ்வளவு/i.test(message);
    o.tools = [{ name: /trend|over time|per day|graph|chart/i.test(message) ? "incident_series" : hasPlace && !count ? "place_breakdown" : "incidents", args: {} }];
  }
  return {
    intent: o.intent === "unknown" ? "unknown" : o.intent, language: null, normalized: message, scope, scopeRaw: {},
    tools: o.tools.map((t) => ({ name: t.name, args: { ...toolArgs(t.name, t.args, scope), ...t.args, ...(TOOL_ARGS[t.name] ? {} : { scope }) } })),
    chartEdit: null, actions: o.actions as Partial<ConsoleAction>[], clarify: null, refusal: null, assumptions: [], offline: true
  };
}

// ------------------------------------------------------------------ prompts --

/** Datasets as compact text for the composer: fields, then up to 12 rows as CSV for the data drawn, 5 for the rest (tokens). */
function datasetsText(datasets: Dataset[], focus: (string | null | undefined)[] = []): string {
  return datasets.map((d) => {
    const cols = d.fields.filter((f) => f.kind !== "geo");
    const { rows } = forModel(d.rows.slice(0, !focus.some(Boolean) || focus.includes(d.id) ? 12 : 5));
    const csv = rows.map((r) => cols.map((f) => String(r[f.key] ?? "").replace(/[,\n]/g, " ").slice(0, 90)).join(",")).join("\n");
    const head = `${d.id}: ${d.title} (${d.rows.length} rows${d.total != null && d.total !== d.rows.length ? ` of ${d.total}` : ""})`
      + `${d.normal ? `; usual range ${d.normal.lo}-${d.normal.hi}` : ""}`;
    return `${head}\nfields: ${cols.map((f) => `${f.key}[${f.kind}${f.unit ? `, ${f.unit}` : ""}]`).join(", ")}\n${cols.map((f) => f.key).join(",")}\n${csv}`;
  }).join("\n\n");
}

/** Facts worth showing the composer: headline figures first, then the chart's dataset, within a budget. */
function promptFacts(facts: Fact[], p: Presentation): Fact[] {
  const key = p.chart?.dataset;
  const score = (f: Fact) => /^(kpi|briefing|tasks|gaps|list|series\.(total|max|min|mean|normal|above)|env\.(warning|places|matching)|stories\.count|feeds|contacts\.count|scope)/.test(f.id) ? 0
    : key && f.id.startsWith(`${key}.`) && !/\.(rank|share)$/.test(f.id) ? 1 : key && f.id.startsWith(`${key}.`) ? 2 : /\.(total|max|min|lead|avg|change_pct)$/.test(f.id) ? 3 : 4;
  // "rows shown on the card" is layout, not a count of anything: kept for the verifier, not offered to the composer
  return [...facts].filter((f) => !/\.rows$/.test(f.id)).sort((a, b) => score(a) - score(b)).slice(0, 60);
}

function allowedActionsText(p: Presentation, results: ToolResult[], answerPeriod: string | null, consolePeriod: string): string {
  const ids = results.flatMap((r) => r.incidentIds).slice(0, 12);
  // setting the console's period only makes sense when the answer covers another period than the console shows
  // no page redirects from the chat (the Briefing page): the answer itself is the briefing
  const parts = [...(answerPeriod && answerPeriod !== consolePeriod ? [`set_period(${answerPeriod})`] : [])];
  for (const d of p.datasets) {
    if (d.drill?.action === "filter_zone") parts.push("filter_zone(zone 1-15 from DATASETS)");
    if (d.drill?.action === "filter_dept") parts.push("filter_dept(dept code from DATASETS)");
    if (d.drill?.action === "filter_taluk") parts.push("filter_taluk(taluk code from DATASETS)");
  }
  if (ids.length) parts.push(`open_incident(id one of ${ids.join(", ")})`);
  if (results.some((r) => r.tool === "developing_stories")) parts.push("open_story");
  return [...new Set(parts)].join("; ");
}

// ----------------------------------------------------------------- ad hoc --

const TABLE_HINTS: [RegExp, string[]][] = [
  [/news|outlet|headline|media|article/i, ["documents", "gaps"]],
  [/police|complaint|grievance|pwd|hospital|source|channel|response|respond/i, ["events"]],
  [/rain|aqi|air|lake|reservoir|bed|hospital|temperature|humid|gauge|inflow|weather/i, ["observations", "observation_signals"]],
  [/daily|per day|trend|history|baseline|usual/i, ["daily_counts"]],
  [/spike|unusual|anomal|rise/i, ["anomalies"]],
  [/hotspot|cluster/i, ["hotspots"]],
  [/alert|warning/i, ["alerts"]],
  [/work|budget|sanction|spend|progress|contract/i, ["pwd_works"]],
  [/festival|protest|rain day|calendar/i, ["world_calendar"]],
  [/price|mandi|market|tomato|onion|potato|vegetable/i, ["mandi_market_prices", "mandi_prices", "mandi_weekly"]],
  [/official|officer|contact|commissioner/i, ["official_contacts"]],
  [/task|action|step/i, ["actions"]],
  [/ward/i, ["ref_wards"]],
  [/facility|station|hospital/i, ["ref_facilities"]],
  [/review|queue|quality/i, ["review_queue", "data_quality"]],
  [/source|feed|fresh/i, ["source_health", "sources"]]
];
function tablesFor(q: string): string[] {
  const out = new Set(["incidents", "ref_departments", "ref_zones", "ref_taluks", "ref_categories"]);
  for (const [re, ts] of TABLE_HINTS) if (re.test(q)) ts.forEach((t) => out.add(t));
  return [...out];
}

function resultDataset(r: QueryResult): Dataset {
  const c = r.compiled;
  const fields: Field[] = [
    ...c.dims.map((d) => ({ key: d.alias, label: d.col.d, kind: d.time ? ("time" as const) : ("category" as const) })),
    ...c.measures.map((m) => ({ key: m.alias, label: m.col ? `${m.fn} of ${m.col.d}` : "count", kind: "value" as const, unit: m.col?.unit ?? null,
      format: m.fn === "avg" ? ("decimal1" as const) : ("integer" as const) })),
    ...c.measures.filter(() => !!c.previous).map((m) => ({ key: `${m.alias}_prev`, label: `${m.alias}, previous period`, kind: "value" as const, format: "integer" as const }))
  ];
  if (c.records) for (const k of Object.keys(r.rows[0] ?? {})) if (!fields.some((f) => f.key === k)) fields.push({ key: k, label: k, kind: "text" });
  const zoneDim = c.dims.find((d) => d.col.name === "zone_no");
  // a readable title: "daily_ward_counts" -> "Weekly ward counts" once the days were re-grouped by week
  const td = c.dims.find((d) => d.time);
  let title = r.purpose.includes(" ") ? r.purpose : r.purpose.replace(/_/g, " ");
  if (td?.grain === "week" || td?.grain === "month") title = title.replace(/\b(daily|per day|by day)\b/i, (m) => /daily/i.test(m) ? `${td.grain}ly` : `by ${td.grain}`);
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return {
    id: r.id, title, fields: zoneDim ? [...fields, { key: "zone", label: "Zone", kind: "id" }] : fields,
    rows: r.rows.map((x) => ({ ...(x as DataRow), ...notRecorded(c.dims, x), ...(zoneDim ? { zone: Number(x[zoneDim.alias]) } : {}) })), total: r.total, hasPrev: !!c.previous,
    drill: zoneDim ? { field: "zone", action: "filter_zone" } : null
  };
}

function adhocChart(plan: QueryPlan, ds: Dataset): ChartSpec | null {
  const x = ds.fields.find((f) => f.kind === "category" || f.kind === "time");
  const y = ds.fields.find((f) => f.kind === "value" && !f.key.endsWith("_prev"));
  if (!y) return null;
  const time = ds.fields.find((f) => f.kind === "time");
  const cat = ds.fields.find((f) => f.kind === "category");
  const t: ChartType = plan.chartIntent === "trend" || time ? "line" : plan.chartIntent === "composition" && ds.rows.length <= 6 ? "donut"
    : plan.chartIntent === "geo" && ds.fields.some((f) => f.key === "zone") ? "map_zones" : ds.rows.length <= 1 ? "kpi" : "horizontal_bar";
  if (t === "kpi") return null;
  if (time && cat) return spec({ type: ds.rows.length > 60 ? "heatmap" : "line", dataset: ds.id, x: time.key, series: cat.key, y: [y.key], sort: "none", highlight: "last", title: ds.title });
  return spec({ type: t, dataset: ds.id, x: (time ?? x)?.key ?? null, y: [y.key], compare: ds.hasPrev === true, sort: time ? "none" : "desc", highlight: time ? "last" : "max", title: ds.title });
}

/** A group with no value (an incident with no ward) is labelled, not shown as "null". */
function notRecorded(dims: QueryResult["compiled"]["dims"], x: Record<string, unknown>): DataRow {
  return Object.fromEntries(dims.filter((d) => !d.time && x[d.alias] == null).map((d) => [d.alias, "Not recorded"]));
}

function adhocFacts(results: QueryResult[]): Fact[] {
  const out: Fact[] = [];
  for (const r of results) {
    const dims = r.compiled.dims;
    for (const row of r.rows.slice(0, 60)) {
      const key = dims.map((d) => slug(String(row[d.alias]))).join(".") || "all";
      const label = dims.map((d) => d.time ? `${d.grain && d.grain !== "day" ? `${d.grain} of ` : ""}${String(row[d.alias]).slice(0, 10)}`
        : `${d.col.d} ${row[d.alias] ?? "not recorded"}`).join(", ") || r.purpose;
      for (const m of r.compiled.measures) {
        const what = m.col ? `${m.fn} of ${m.col.d}` : "Count";
        const v = Number(row[m.alias]);
        if (Number.isFinite(v)) out.push({ id: `${r.id}.${key}.${m.alias}`, label: `${what}, ${label}`, value: Math.round(v * 100) / 100 });
        const p = Number(row[`${m.alias}_prev`]);
        if (Number.isFinite(p) && row[`${m.alias}_prev`] != null) out.push({ id: `${r.id}.${key}.${m.alias}.prev`, label: `${what}, ${label}, previous period`, value: p });
      }
    }
    out.push({ id: `${r.id}.groups`, label: `${r.purpose}: groups or records in all`, value: r.total });
  }
  return out;
}

/** The period an ad-hoc query covers, from its own time range ("Since 1 Jul 2026"), for the card's scope line. */
function adhocPeriod(plan: QueryPlan, lang: Lang): string | null {
  const tr = plan.queries[0]?.timeRange;
  if (!tr) return null;
  const d = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString(lang === "ta" ? "ta-IN" : "en-IN",
    { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const UNIT_TA: Record<string, string> = { hour: "மணி நேரம்", day: "நாட்கள்", week: "வாரங்கள்", month: "மாதங்கள்" };
  if (tr.mode === "all") return { en: "All dates", ta: "எல்லா தேதிகளும்", tanglish: "Ella dates-um" }[lang];
  if (tr.mode === "relative" && tr.last && tr.unit) return { en: `Last ${tr.last} ${tr.unit}${tr.last > 1 ? "s" : ""}`, ta: `கடந்த ${tr.last} ${UNIT_TA[tr.unit]}`,
    tanglish: `Last ${tr.last} ${tr.unit}${tr.last > 1 ? "s" : ""}` }[lang];
  if (tr.mode === "since" && tr.from) return { en: `Since ${d(tr.from)}`, ta: `${d(tr.from)} முதல்`, tanglish: `${d(tr.from)} la irundhu` }[lang];
  if (tr.mode === "between" && tr.from && tr.to) return { en: `${d(tr.from)} to ${d(tr.to)}`, ta: `${d(tr.from)} – ${d(tr.to)}`, tanglish: `${d(tr.from)} – ${d(tr.to)}` }[lang];
  return null;
}

// ------------------------------------------------------------------- main --

export async function ask(i: ChatInput): Promise<ChatOutput> {
  const [now, names] = await Promise.all([storeAsOf(), refNames()]);
  warmUp(now);
  // `typed` is kept as the Collector wrote it; everything below reads `message`, with typos corrected toward the
  // district's vocabulary ("tomatoe prifce" -> "tomato price", "incidnets in adyr" -> "incidents in adyar")
  const typed = i.message.replace(/\s+/g, " ").trim().slice(0, LIMITS.messageChars);
  const spelled = await correctSpelling(typed).catch(() => ({ text: typed, fixes: [] as { from: string; to: string }[] }));
  const message = spelled.text;
  const detected = detectLanguage(typed);
  let lang: Lang = i.language !== "auto" ? i.language : detected.lang;
  const consoleScope = ScopeSchema.parse(i.lockDept ? { ...i.scope, dept: i.lockDept } : i.scope);
  const sessionId = await ensureSession(i.user, i.sessionId, typed);
  const turns = await recentTurns(i.user, sessionId, 10);
  const models: CallInfo[] = [];
  const notes: string[] = [];
  let route: Route | null = null;
  const card0 = (scope: Scope | null) => baseCard(lang, scope, scope ? describeScope(scope, names, lang, now) : "", now);

  const finish = async (card: AnswerCard, plan: unknown): Promise<ChatOutput> => {
    card.sources.models = models.map((m) => ({ step: m.step, provider: m.provider, model: m.model, ms: m.ms, tokens: m.inputTokens + m.outputTokens,
      inTokens: m.inputTokens, outTokens: m.outputTokens }));
    card.sources.assumptions = [...new Set([...(route?.assumptions ?? []), ...card.sources.assumptions])];
    card.sources.limits = [...new Set([...notes, ...card.sources.limits])];
    // a department console has no department filter to switch
    if (i.lockDept) {
      card.consoleActions = card.consoleActions.filter((a) => a.action !== "filter_dept");
      card.autoActions = card.autoActions.filter((a) => a.action !== "filter_dept");
    }
    if (route?.offline && card.kind === "answer") card.offline = true;
    // what was corrected, shown on the card ("Understood as: tomato price") and kept in the sources
    if (spelled.fixes.length && card.kind !== "refusal") {
      card.understood = message;
      card.sources.assumptions.unshift(`Read ${spelled.fixes.map((f) => `"${f.from}" as "${f.to}"`).join(", ")}.`);
    }
    await addMessage({ sessionId, role: "user", text: typed, language: lang, inputMode: i.inputMode, scope: consoleScope });
    const messageId = await addMessage({ sessionId, role: "assistant", text: card.headline, language: lang, payload: { ...card, id: undefined }, plan, scope: card.scope });
    card.id = messageId;
    await audit(i.user, "assistant:answer", "assistant_messages", messageId, null, {
      kind: card.kind, intent: route?.intent ?? null, tools: card.sources.tools.map((t) => t.name), sql: card.sources.sql.length,
      verifier: card.sources.verifier, language: lang, inputMode: i.inputMode, models: card.sources.models.map((m) => `${m.step}:${m.provider}`)
    });
    return { card, sessionId, messageId };
  };

  // 1. checks in code, before any model
  // on the words as typed, and on the corrected ones (a misspelt "delet all complaints" is still refused)
  let guard = await codeGuard(typed);
  if (message !== typed && (!guard || guard.kind === "bulk")) guard = (await codeGuard(message)) ?? guard;
  if (guard?.kind === "unsafe") return finish(refusalCard(card0(null), guard.reason), { intent: "unsafe", guard: guard.reason });
  // plainly off-topic ("who won the IPL?"): answered at once, no model, no tokens
  if (guard?.kind === "off_topic") return finish(refusalCard(card0(null), null, guard.topic), { intent: "out_of_scope", guard: guard.topic });

  // 2. understand
  i.stage("understanding");
  const placeData = await runTool("resolve_place", { text: message }).then((r) => r.data as Row | null).catch(() => null);
  const place = placeData ? JSON.stringify(placeData) : "";
  const lastId = turns.filter((t) => t.role === "assistant").slice(-1)[0]?.message_id ?? "";
  const routeKey = `${lang}|${message.toLowerCase()}|${scopeKey(consoleScope)}|${now}|${lastId}`;
  // a pin re-runs its own tools (no router): same question, same design, latest data
  const pin = i.pinId ? await getPin(i.user, i.pinId) : null;
  const pinTools = (pin?.plan?.tools ?? []) as { name: string; args: Record<string, unknown> }[];
  if (pin && pinTools.length) {
    const s = (pinTools.find((t) => t.args?.scope)?.args.scope as Scope | undefined) ?? consoleScope;
    route = { intent: "tool_question", language: null, normalized: String(pin.question), scope: s, scopeRaw: {}, tools: pinTools, chartEdit: null, actions: [],
      clarify: null, refusal: null, assumptions: ["Pinned answer, run again on the latest data."], offline: false };
  }
  // an insight opens with its own tools too; its "why it matters" travels with the card
  const insight = !route && i.insightKey ? await insightByKey(i.user, i.insightKey, i.lockDept ?? null) : null;
  if (insight) {
    const s = (insight.tools.find((t) => t.args?.scope)?.args.scope as Scope | undefined) ?? consoleScope;
    route = { intent: "tool_question", language: null, normalized: insight.question, scope: s, scopeRaw: {}, tools: insight.tools, chartEdit: null, actions: [],
      clarify: null, refusal: null, assumptions: [`From today's insights: ${insight.finding}`], offline: false };
  }
  if (!route) route = cached<Route>(routeKey);
  if (!route) {
    if (aiStatus().available) {
      try {
        route = await llmRoute(i, message, detected.lang, consoleScope, names, turns, place, now, models);
        remember(routeKey, route);
      } catch (e) {
        if (i.signal?.aborted) throw e;
        if (e instanceof AiBudgetError) return finish(errorCard(card0(null), e.message), { intent: "error" });
        notes.push(e instanceof AiBusyError ? `The AI service was busy (retry in ${e.retryAfter} s), so this was answered from the data without it.`
          : `The AI step failed (${(e as Error).message.slice(0, 200)}), so this was answered from the data without it.`);
        route = rulesRoute(message, consoleScope, names, placeData?.zone != null);
      }
    } else {
      const problem = aiStatus().problem;
      notes.push(problem ? `${problem}: this was answered from the data by rules, without the language model. Paste fresh AWS keys into the portal's .env.`
        : "No AI provider is configured (the AWS keys for Amazon Bedrock), so this was answered by simple rules, without the language model.");
      route = rulesRoute(message, consoleScope, names, placeData?.zone != null);
    }
  }
  // the reply language: the chip, else Tamil script, else the rules' or the router's Tanglish
  if (i.language === "auto") lang = detected.lang !== "en" ? detected.lang : route.language === "tanglish" || (route.language === "ta" && !hasTamilScript(message)) ? "tanglish" : route.language === "ta" ? "ta" : "en";
  if (guard?.kind === "bulk" && !["out_of_scope", "unsafe", "email_followup"].includes(route.intent)) route = { ...route, intent: "bulk_request" };
  // Tools first: when the router sends a question to the planner but a console tool clearly answers it, the tool wins
  // (its numbers are the console's); the planner stays for groupings no tool offers.
  if (route.intent === "adhoc_question" && !route.offline && !/\b(ward|channel|source|per day|daily|hourly|by hour|between|from \d)/i.test(message)) {
    // the rules' pick, on the router's scope: a specific tool, or the incidents list for a question naming a category or a place
    const rules = rulesRoute(message, route.scope, names, placeData?.zone != null);
    const t = rules.tools[0];
    const countOrList = /how many|evlo|evvalo|evvalavu|count|number of|\bany\b|\blist\b|\bshow\b|எத்தனை|எவ்வளவு/i.test(message)
      && !/\b(average|avg|mean|median|resolution time|per|by (zone|department|category|month|week|day))\b/i.test(message);
    if (rules.intent === "tool_question" && t && (PREFER_TOOL.has(t.name) || (t.name === "incidents" && countOrList))) {
      route = { ...route, intent: "tool_question", scope: rules.scope, tools: [t], assumptions: [...route.assumptions, `Answered with the console's ${t.name} data.`] };
    }
  }
  // "only Adyar zone", "what about last month?", "same for Zone 9": a short follow-up that changes only where or when re-asks the
  // previous answer with that change (the conversation's memory), whatever new question the router read into it
  const prevAnswer = turns.some((t) => t.role === "assistant" && t.plan?.tools?.length);
  if (prevAnswer && isRefinement(message, !!placeData) && !["out_of_scope", "unsafe", "chart_edit", "console_action", "help", "smalltalk"].includes(route.intent)) {
    const raw: Row = { ...route.scopeRaw };
    if (placeData?.zone != null && raw.zone == null) raw.zone = placeData.zone;
    route = { ...route, intent: "plan_edit", tools: [], scopeRaw: raw, assumptions: [...route.assumptions, "Read as a follow-up: the previous answer, with this change."] };
  }
  // "only Zone 13" after an answer re-asks that answer for Zone 13; changing the console itself needs the message to say so
  if (route.intent === "console_action" && turns.some((t) => t.role === "assistant" && t.plan?.tools?.length)
    && !/\b(console|dashboard|screen|page|open)\b|கன்சோல்|டாஷ்போர்டு/i.test(message)) {
    const raw: Row = { ...route.scopeRaw };
    for (const a of route.actions) {
      if (a.action === "filter_zone" && a.zone != null) raw.zone = a.zone;
      if (a.action === "filter_taluk" && a.taluk) raw.taluk = a.taluk;
      if (a.action === "filter_dept" && a.dept) raw.dept = a.dept;
      if (a.action === "filter_cat" && a.cat) raw.cat = a.cat;
      if (a.action === "set_period" && a.period) raw.period = a.period;
    }
    route = { ...route, intent: "plan_edit", scopeRaw: raw, actions: [], tools: [] };
  }
  // "road accident trend": one category over time is incident_series; category_trends is for comparing categories
  if (route.intent === "tool_question" && route.scope.cat && route.tools.length === 1 && route.tools[0].name === "category_trends"
    && !/\b(categor|compare|vs\.?|versus|types?|each|all)\b|வகை/i.test(message)) {
    route = { ...route, tools: [{ name: "incident_series", args: { scope: route.scope } }],
      assumptions: [...route.assumptions, "One category over time: answered with its incident series and usual range."] };
  }
  // a place is a filter, not a keyword: "Velachery" searched as text finds only incidents whose title says so
  if (placeData && (placeData.zone != null || placeData.asked_for_taluk) && route.intent === "tool_question") route = placeAsScope(route, placeData, names);
  // smalltalk is greetings and thanks; "what does test data mean?" is a help question
  if (route.intent === "smalltalk" && !SMALLTALK.test(message) && isHelpQuestion(message)) route = { ...route, intent: "help" };
  // a short "make it a pie" / "show on map" after an answer is a chart edit, whatever the router called it
  if (route.intent !== "chart_edit" && !["out_of_scope", "unsafe"].includes(route.intent) && turns.some((t) => t.role === "assistant")
    && message.length <= 40 && editFromText(message) && isBareEdit(message)) route = { ...route, intent: "chart_edit" };
  // "what is this murder case in Adyar?": one specific incident, told as a story, whatever list the router picked
  if (["tool_question", "adhoc_question"].includes(route.intent) && STORY.test(message) && STORY_THING.test(message)
    && !route.tools.some((t) => t.name === "incident_story" || t.name === "incident_detail")) {
    route = { ...route, intent: "tool_question", tools: [{ name: "incident_story", args: { text: message, scope: route.scope } }],
      assumptions: [...route.assumptions, "Read as a question about one incident: its story."] };
  }
  // several subjects in one question ("road accidents, flooding and public-infrastructure complaints"): every part is answered,
  // side by side, instead of the data being narrowed to the one subject a single category filter can hold
  const parts = ["tool_question", "adhoc_question", "briefing", "insight_request"].includes(route.intent)
    && !route.tools.some((t) => ["incident_story", "incident_detail", "mandi_prices", "environment", "contacts"].includes(t.name)) ? multiPart(message) : null;
  if (parts) {
    route = { ...route, intent: "tool_question", scope: { ...route.scope, cat: null }, tools: [{ name: "category_summary", args: { scope: { ...route.scope, cat: null }, parts } }],
      assumptions: [...route.assumptions.filter((a) => !/^Narrowed to /.test(a)), `Answered part by part: ${parts.map((x) => x.label).join("; ")}.`] };
  }
  // "how many road accidents": a keyword that only repeats the category filter would search titles for "road accidents"
  // (they say "Road accident") and find none; the category already narrows the list
  route = { ...route, tools: route.tools.map((t) => {
    // a severity or status filter only when the question names one ("how many road accidents" is all of them, not the severe ones)
    if (t.args.sev && !/\b(severe|serious|critical|high|medium|low|minor|major|grave)\b|கடுமை|தீவிர/i.test(message)) t = { ...t, args: { ...t.args, sev: null } };
    if (t.args.status && !/\b(open|pending|unresolved|ongoing|in progress|closed|resolved|awaiting|verif\w*|unverified|critical|lapsed)\b|நிலுவை/i.test(message)) t = { ...t, args: { ...t.args, status: null } };
    const q = typeof t.args.q === "string" ? t.args.q.trim() : "";
    const cat = (t.args.scope as Scope | undefined)?.cat;
    if (!q || !cat) return t;
    const label = (names.cats.get(cat)?.label ?? "").toLowerCase();
    const stem = (w: string) => w.toLowerCase().replace(/(es|s)\b/g, "").replace(/[^a-z ]+/g, " ").trim();
    const repeats = classify(q)?.code === cat || (!!label && (stem(label).includes(stem(q)) || stem(q).includes(stem(label))));
    return repeats ? { ...t, args: { ...t.args, q: null } } : t;
  }) };
  // a story needs the words that describe the incident: the question itself when the router gave none
  route = { ...route, tools: route.tools.map((t) => (t.name === "incident_story" && !String(t.args.text ?? "").trim() ? { ...t, args: { ...t.args, text: message } } : t)) };
  if (i.lockDept) route = { ...route, scope: { ...route.scope, dept: i.lockDept }, tools: lockTools(route.tools, i.lockDept, route.scope, notes) };
  const plan = { intent: route.intent, normalized: route.normalized, scope: route.scope, tools: route.tools, chartEdit: route.chartEdit, offline: route.offline };

  switch (route.intent) {
    case "out_of_scope":
      return finish(refusalCard(card0(null), null), plan);
    case "unsafe":
      return finish(refusalCard(card0(null), /personal|phone|address|aadhaa?r|name/i.test(route.refusal ?? "") ? "personal data"
        : /delet|chang|modif|updat|data change/i.test(route.refusal ?? "") ? "data change" : /email|mail/i.test(route.refusal ?? "") ? "email outside the official directory"
          : /instruction|prompt|rule/i.test(route.refusal ?? "") ? "instructions" : null), plan);
    case "smalltalk":
      return finish(smalltalkCard(card0(null)), plan);
    case "email_followup":
      return finish(notYetCard(card0(null)), plan);
    case "unknown":
      return finish(clarifyCard(card0(null), { en: "I could not work that out without the language model. Try one of these:", ta: "மொழி மாதிரி இல்லாமல் இதைப் புரிந்துகொள்ள முடியவில்லை. இவற்றில் ஒன்றைக் கேளுங்கள்:",
        tanglish: "Language model illama idhu puriyala. Idhula onnu kelunga:" }[lang]), plan);
    case "console_action": {
      const acts = validActions(route.actions, names, lang, []);
      return finish(actionCard(card0(route.scope), acts), plan);
    }
  }
  if (route.clarify) return finish(clarifyCard(card0(route.scope), route.clarify), plan);

  // 3. fetch
  i.stage("fetching");
  if (route.intent === "chart_edit") {
    const edited = await chartEdit(i, route, lang, names, now, sessionId);
    if (edited) return finish(edited.card, { ...plan, intent: "chart_edit", tools: edited.tools });
  }
  let tools = route.tools;
  // what the answer is about: a follow-up ("only Zone 13") is read as the question it edits
  let question = message;
  if ((route.intent === "plan_edit" || route.intent === "chart_edit") && !tools.length) {
    // the previous answer's tools, on the previous answer's scope with only the changes the follow-up asked for
    const at = turns.findLastIndex((t) => t.role === "assistant" && t.plan?.tools?.length);
    const prev = turns[at];
    const prevQ = at > 0 && turns[at - 1].role === "user" ? String(turns[at - 1].content_text ?? "") : "";
    // the router tends to echo the console's period; a follow-up keeps the previous answer's period unless it names one
    const change: Row = { ...route.scopeRaw };
    if (!PERIOD_WORDS.test(message)) delete change.period;
    tools = (prev?.plan?.tools ?? []).map((t: Row) => ({ name: t.name, args: t.args?.scope ? { ...t.args, scope: applyScope(t.args.scope as Scope, change, names) } : t.args }));
    const s = tools.find((t) => t.args.scope)?.args.scope as Scope | undefined;
    if (s) route = { ...route, scope: s };
    if (prevQ) question = `${prevQ} (${message})`;
  }
  if ((route.intent === "briefing" || route.intent === "insight_request") && !tools.some((t) => t.name === "briefing")) tools = [{ name: "briefing", args: { scope: route.scope } }, ...tools].slice(0, 3);
  if (route.intent === "bulk_request") {
    tools = [{ name: "overview_kpis", args: { scope: route.scope } }, { name: "zones", args: { scope: route.scope } }, { name: "departments", args: { scope: route.scope } }];
    notes.push(`Large requests are summarised rather than listed: at most ${LIMITS.rowsShown} records are shown in an answer and ${LIMITS.exportRows.toLocaleString("en-IN")} rows exported.`);
  }
  if (route.intent === "help") return finish(await helpAnswer(i, route, message, lang, names, now, models), plan);

  const results: ToolResult[] = [];
  const toolLog: AnswerCard["sources"]["tools"] = [];
  let adhoc: { plan: QueryPlan; results: QueryResult[] } | null = null;
  let usePlanner = route.intent === "adhoc_question" || (!tools.length && route.intent === "tool_question");
  // tools first: a tool question the router named no tool for, or a planner question a console tool clearly answers
  // ("tomato price"), takes the rules' pick; the planner is for groupings no tool offers, and is slower and less certain
  const rulesPick = usePlanner ? rulesRoute(message, route.scope, names, placeData?.zone != null) : null;
  if (rulesPick && rulesPick.intent === "tool_question" && rulesPick.tools.length
    && ((!tools.length && route.intent === "tool_question") || PREFER_TOOL.has(rulesPick.tools[0].name))) {
    tools = rulesPick.tools;
    usePlanner = false;
    route = { ...route, intent: "tool_question", scope: rulesPick.scope, assumptions: [...route.assumptions, `Answered with the console's ${tools[0].name} data.`] };
  }
  if (usePlanner) {
    if (!aiStatus().available) return finish(clarifyCard(card0(route.scope), "This question needs the query planner, which needs the AI provider (the AWS keys for Amazon Bedrock)."), plan);
    try {
      adhoc = await planAndRun(i, route, message, now, models);
    } catch (e) {
      if (i.signal?.aborted) throw e;
      if (e instanceof AiBusyError || e instanceof AiUnavailableError) return finish(errorCard(card0(route.scope), (e as Error).message), plan);
      // the planner could not build a query: the console's own data for the question, when the rules find some
      if (rulesPick && rulesPick.intent === "tool_question" && rulesPick.tools.length) {
        tools = rulesPick.tools;
        usePlanner = false;
        notes.push("The query planner could not build a query for this; it was answered with the console's own data instead.");
      } else {
        return finish(errorCard(card0(route.scope), { en: "I could not build a query for that question from the data I have.", ta: "என்னிடம் உள்ள தரவைக் கொண்டு இந்தக் கேள்விக்கு பதில் தயாரிக்க முடியவில்லை.",
          tanglish: "Ennoda data-la indha kelvikku query build panna mudiyala." }[lang]), { ...plan, error: (e as Error).message });
      }
    }
  }
  if (!usePlanner) {
    // a follow-up re-runs the previous answer's tools: they are locked again
    if (i.lockDept) tools = lockTools(tools, i.lockDept, route.scope, notes);
    for (const t of tools.slice(0, LIMITS.queriesPerQuestion)) {
      const t0 = Date.now();
      try {
        const r = await runTool(t.name, t.args);
        if (i.lockDept && otherDeptsIncident(r, i.lockDept)) {
          notes.push("That incident is handled by another department, so it is not shown on your department's console.");
          continue;
        }
        results.push(r);
        toolLog.push({ name: t.name, args: t.args, ms: Date.now() - t0 });
      } catch (e) {
        if (e instanceof ToolError) notes.push(`Skipped ${t.name}: ${e.message}`);
        else throw e;
      }
    }
    if (!results.length) return finish(errorCard(card0(route.scope), { en: "I could not fetch data for that question.", ta: "அந்தக் கேள்விக்கான தரவைப் பெற முடியவில்லை.",
      tanglish: "Andha kelvikku data edukka mudiyala." }[lang]), plan);
  }

  // 4. compose
  i.stage("drawing");
  // readings, prices and directories are not period-bound: their card says "Latest data", not the console's period
  const scope = adhoc ? route.scope : results[0]?.scope ?? null;
  const base = baseCard(lang, scope, scope ? describeScope(scope, names, lang, now) : `${TEXT.latest[lang]} · ${TEXT.asOf[lang]} ${fmtAsOf(now, lang)}`, now);
  // an ad-hoc query sets its own dates ("since July"): the card says those, not the console's period
  const adhocDates = adhoc ? adhocPeriod(adhoc.plan, lang) : null;
  if (adhocDates && base.scopeLine) base.scopeLine = base.scopeLine.replace(/^[^·]+·/, `${adhocDates} ·`);
  let p: Presentation;
  let facts: Fact[];
  let testData: boolean;
  let caveats: string[];
  // "top 3" shows three: the drawn dataset keeps exactly that many rows
  const topN = requestedCount(question) ?? requestedCount(route.normalized);
  if (adhoc) {
    const datasets = adhoc.results.map(resultDataset);
    const chart = datasets[0] ? adhocChart(adhoc.plan, datasets[0]) : null;
    p = { datasets, chart, kpis: [], table: chart ? null : datasets[0]?.id ?? null, display: chart ? (chart.type.startsWith("map") ? "map" : "chart") : "table" };
    if (datasets[0] && datasets[0].rows.length === 1 && !chart) {
      const vf = datasets[0].fields.filter((f) => f.kind === "value");
      p.kpis = vf.map((f) => ({ label: f.label, value: Number(datasets[0].rows[0][f.key]), format: f.format }));
      p.display = "kpi";
    }
    if (topN) p = applyTopN(p, topN, question);
    facts = [...adhocFacts(adhoc.results), ...buildFacts([], p.datasets)];
    testData = adhoc.results.some((r) => r.testData);
    caveats = [...adhoc.results.flatMap((r) => r.notes), ...(testData ? ["Includes test (synthetic) data."] : [])];
    base.sources.sql = adhoc.results.flatMap((r) => r.sql.map((s) => ({ text: s.text, params: s.params })));
    base.sources.plan = adhoc.plan;
    base.sources.rows = adhoc.results.reduce((a, r) => a + r.rows.length, 0);
    base.sources.refs = [...new Set(adhoc.results.map((r) => r.compiled.table.name))].map((t) => ({ kind: "table", name: t }));
    base.sources.assumptions.push(...adhoc.plan.assumptions);
  } else {
    p = presentAll(results, question, lang);
    if (topN) p = applyTopN(p, topN, question);
    facts = buildFacts(results, p.datasets);
    testData = results.some((r) => r.testData);
    caveats = [...new Set(results.flatMap((r) => r.caveats))];
    base.sources.tools = toolLog;
    base.sources.refs = results.flatMap((r) => r.sources);
    base.sources.incidentIds = [...new Set(results.flatMap((r) => r.incidentIds))].slice(0, 40);
    base.sources.rows = p.datasets.reduce((a, d) => a + d.rows.length, 0);
  }
  const taluk = scope?.taluk ? names.taluks.get(scope.taluk) : null;
  if (taluk?.note) caveats.push(`${taluk.name} taluk: ${taluk.note}.`);
  if (insight) {
    caveats.unshift(`Why it matters: ${insight.why}`);
    base.sources.incidentIds = [...new Set([...insight.incidentIds, ...base.sources.incidentIds])].slice(0, 40);
  }
  // a locality has no filter of its own: say the figures cover the zone (and taluk) around it, so the answer cannot claim the locality
  const loc = placeData?.place ? String(placeData.place) : null;
  const zoneName = scope?.zone != null ? names.zones.get(scope.zone)?.name ?? null : null;
  const matchedByName = results.some((r) => r.tool === "place_breakdown" && (r.data as Row | null)?.locality);
  if (loc && scope && placeData?.zone != null && scope.zone === placeData.zone && zoneName && zoneName.toLowerCase() !== loc.toLowerCase()
    && !(taluk && taluk.name.toLowerCase() === loc.toLowerCase()) && !matchedByName) {
    caveats.push(`${loc} has no filter of its own: these figures cover ${zoneName} zone (Zone ${scope.zone})${taluk ? ` within ${taluk.name} taluk` : ""}, which includes it.`);
  }
  const namedTaluk = placeData?.taluk_named as Row | null | undefined;
  if (namedTaluk && namedTaluk.code !== scope?.taluk && namedTaluk.code !== placeData?.taluk) {
    caveats.push(`${namedTaluk.name} is also a revenue taluk${namedTaluk.note ? ` (${namedTaluk.note})` : ""}; ask for "${namedTaluk.name} taluk" to see it.`);
  }

  let card = await compose(i, { base, route, message: question, lang, p, facts, testData, caveats, results, names, models, now, previous: plainSummary(turns), count: topN,
    parts: ((results.find((r) => r.tool === "category_summary")?.data as Row | undefined)?.parts as Row[] | undefined)?.map((x) => String(x.part)) ?? null,
    visual: needsPicture(question, results, !!route.visual || !!insight || !!pin?.chart) });
  if (insight) card = { ...card, insightKey: insight.key };
  // a pin keeps the chart the Collector chose
  if (pin?.chart && card.kind === "answer") {
    const c = checkChart(pin.chart as ChartSpec, card.datasets, card.chart).spec;
    if (c) card = { ...card, chart: c, display: c.type.startsWith("map") ? "map" : c.type === "table" ? "table" : "chart" };
  }
  if (route.intent === "bulk_request") card = bulkFinish(card, route, names, lang, message, p);
  return finish(card, { ...plan, tools: toolLog.map((t) => ({ name: t.name, args: t.args })), adhoc: adhoc?.plan ?? null });
}

// ---------------------------------------------------------------- compose --

interface ComposeCtx {
  base: AnswerCard; route: Route; message: string; lang: Lang; p: Presentation; facts: Fact[]; testData: boolean; caveats: string[];
  results: ToolResult[]; names: RefNames; models: CallInfo[]; now: string;
  /** the last few turns, so the answer can refer back to them */
  previous: string;
  /** how many items the question asked for ("top 3"), or null */
  count: number | null;
  /** the subjects of a question about several at once, each to be answered */
  parts: string[] | null;
  /** the question asks for a chart, graph, diagram or map; otherwise the card answers in words and offers the picture */
  visual: boolean;
}

async function compose(i: ChatInput, c: ComposeCtx): Promise<AnswerCard> {
  const { base, p, facts, lang } = c;
  base.datasets = p.datasets;
  base.kpis = p.kpis;
  base.testData = c.testData;
  const quotable = p.datasets.flatMap((d) => d.rows.flatMap((r) => Object.values(r).filter((v): v is string => typeof v === "string" && v.length > 12)));
  const context = contextNumbers(c.message, base.scopeLine, c.route.normalized);
  const fallback = (why: string | null): AnswerCard => {
    const t = templateCard({ ...base, table: p.table, display: p.display, chart: p.chart ? checkChart(p.chart, p.datasets).spec : null, caveats: c.caveats }, p, facts, p.kpis);
    t.followUps = EXAMPLES[lang].slice(0, 3);
    t.sources.verifier = { checked: 0, unmatched: [], regenerated: false, template: true };
    if (why) t.sources.limits.push(why);
    t.consoleActions = validActions(defaultActions(p, c.results), c.names, lang, base.sources.incidentIds);
    t.visualAsked = c.visual;
    if (!c.visual) {
      const list = wantsTable(c.message) ? t.table ?? t.datasets[0]?.id ?? null : null;
      t.display = list ? "table" : "text";
      if (list) t.table = list;
    }
    return t;
  };
  if (c.route.offline || !aiStatus().available) return fallback(null);

  const cache = `card|${lang}|${c.route.normalized.toLowerCase()}|${JSON.stringify(c.route.tools)}|${c.now}`;
  const hit = cachedCard(cache);
  if (hit) {
    hit.sources.limits = [...hit.sources.limits, "Same question on the same data as a few minutes ago: the earlier verified answer was reused."];
    return { ...hit, id: base.id };
  }

  // the card's main figure: the answer must state it, not another fact's value in its place ("0 accidents" when 4 match)
  const lead = p.kpis[0] && Number.isFinite(Number(p.kpis[0].value)) ? { label: p.kpis[0].label, value: Number(p.kpis[0].value) } : null;
  const statesLead = (d: ComposerOutput) => !lead || extractNumbers(`${d.headline} ${d.answerMarkdown}`, quotable)
    .some((n) => Math.abs(n.value - lead.value) < 0.01 || Math.abs(n.value - lead.value) <= Math.abs(lead.value) * 0.005);
  const all = facts.find((f) => f.id === "scope.incidents")?.value, syn = facts.find((f) => f.id === "scope.test_incidents")?.value;
  const testLine = !c.testData ? "no" : all != null && syn != null ? (syn >= all ? "yes (all records)" : `yes (${syn} of ${all} incidents)`) : "yes (some records)";
  const ctx = {
    question: c.message, normalized: c.route.normalized, scopeLine: base.scopeLine, asOf: base.asOf, testData: testLine, caveats: c.caveats,
    facts: factLines(promptFacts(facts, p)), lead: lead ? `${lead.label} = ${lead.value}` : "", datasets: datasetsText(p.datasets, [p.chart?.dataset, p.table]), suggested: p.chart ? JSON.stringify(p.chart) : p.display === "kpi" ? "kpi tiles" : "none",
    actions: allowedActionsText(p, c.results, base.scope?.period ?? null, i.scope.period), previous: c.previous, repair: "", count: c.count, parts: c.parts, visual: (c.visual ? "yes" : "no") as "yes" | "no"
  };
  let draft: ComposerOutput | null = null;
  let verdict = { ok: false, checked: 0, unmatched: [] as string[] };
  let regenerated = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await generateJson({ role: "reasoning", name: "composer", schema: ComposerSchema, lenient: ComposerLenient, system: composerSystem(lang), prompt: composerPrompt(ctx),
        temperature: 0.2, maxOutputTokens: 1400, user: i.user, abortSignal: i.signal });
      c.models.push(r.info);
      draft = r.object;
    } catch (e) {
      if (i.signal?.aborted) throw e;
      const why = regenerated ? ` while redrafting (the first draft was rejected: ${verdict.unmatched.join(", ") || "empty text"})` : "";
      return fallback(e instanceof AiBusyError ? `The AI service was busy${why}, so this answer was written from the data by a template.`
        : `The composer failed${why} (${(e as Error).message.slice(0, 160)}); answer written by a template.`);
    }
    if (!draft.headline.trim() || !draft.answerMarkdown.trim()) {
      verdict = { ok: false, checked: 0, unmatched: [] };
      ctx.repair = "The headline and answerMarkdown must not be empty.";
      regenerated = true;
      continue;
    }
    verdict = verifyNumbers([draft.headline, draft.answerMarkdown, draft.voiceSummary, draft.chart?.title ?? "", draft.chart?.subtitle ?? ""], facts, context, quotable);
    if (verdict.ok && !statesLead(draft)) {
      console.warn(`[assistant] draft did not state the lead fact (${lead!.label} = ${lead!.value})`);
      verdict = { ok: false, checked: verdict.checked, unmatched: [`lead fact ${lead!.value} not stated`] };
      ctx.repair = `State the LEAD FACT value (${lead!.label} = ${lead!.value}) as digits in the headline or first sentence.`;
      regenerated = true;
      continue;
    }
    if (verdict.ok) break;
    console.warn(`[assistant] verifier rejected numbers: ${verdict.unmatched.join(", ")}`);
    ctx.repair = `These numbers are not in FACTS: ${verdict.unmatched.join(", ")}. Use only fact values (rounding allowed) or remove them.`;
    regenerated = true;
  }
  if (!draft || !verdict.ok) {
    const t = fallback(`The draft's numbers could not be verified (${verdict.unmatched.join(", ")}), so a template wrote this answer.`);
    t.sources.verifier = { checked: verdict.checked, unmatched: verdict.unmatched, regenerated, template: true };
    return t;
  }

  // a ranking or trend the code drew stays on the card when the model picks plain text: the picture is the evidence
  const keepCode = (draft.display === "text" || (draft.display === "kpi" && !p.kpis.length)) && !!p.chart && (p.display === "chart" || p.display === "map");
  const wantsChart = draft.display === "chart" || draft.display === "map" || keepCode;
  const checked = wantsChart ? checkChart(keepCode ? p.chart : draft.chart, p.datasets, p.chart) : { spec: null, fixes: [] as string[] };
  const chart = checked.spec;
  let display = draft.display;
  if (wantsChart && !chart) display = p.kpis.length ? "kpi" : p.table ? "table" : "text";
  if (chart) display = chart.type.startsWith("map") ? "map" : chart.type === "table" ? "table" : chart.type === "kpi" ? "kpi" : "chart";
  if (display === "kpi" && !p.kpis.length) display = chart ? "chart" : "text";
  // the question decides: a chart or map only when it asked for a picture, a table only when it asked for a list
  if (!c.visual) display = wantsTable(c.message) && !!(p.table ?? p.datasets[0]) ? "table" : "text";
  const table = display === "table" ? p.table ?? p.datasets[0]?.id ?? null : p.table;
  const card: AnswerCard = {
    ...base, display, headline: draft.headline.trim().slice(0, 140), answerMarkdown: dedupeSentences(stripHtml(draft.answerMarkdown), draft.headline).slice(0, 1400),
    voiceSummary: draft.voiceSummary.trim().slice(0, 400), chart: display === "chart" || display === "map" || !c.visual ? chart : null, table, visualAsked: c.visual,
    // a Tanglish voice line should be in Tamil script for the Tamil voice; in English letters, the English (India) voice reads it better
    voiceLang: lang === "tanglish" && !hasTamilScript(draft.voiceSummary) ? "en-IN" : base.voiceLang,
    followUps: draft.followUps.map((f) => f.trim()).filter(Boolean).slice(0, 3),
    consoleActions: validActions((draft.consoleActions.length ? draft.consoleActions
      : defaultActions(p, c.results))
      .filter((a) => a.action !== "set_period" || (a.period !== i.scope.period && a.period === base.scope?.period)), c.names, lang, base.sources.incidentIds),
    // what the figures do not cover (a locality read as its zone) stays on the card even when the draft leaves it out
    caveats: [...new Set([...c.caveats.filter((x) => /has no filter of its own|is also a revenue taluk|by the place name in their records|^Why it matters/.test(x)),
      ...draft.caveats.map((x) => x.trim()).filter(Boolean)])].slice(0, 4)
  };
  card.sources.verifier = { checked: verdict.checked, unmatched: [], regenerated, template: false };
  if (checked.fixes.length) card.sources.limits.push(`Chart checker: ${checked.fixes.join("; ")}.`);
  card.sources.limits.push(...c.caveats.filter((x) => !card.caveats.includes(x)));
  rememberCard(cache, card);
  return card;
}

const cardCache = new Map<string, { at: number; card: AnswerCard }>();
function cachedCard(key: string): AnswerCard | null {
  const hit = cardCache.get(key);
  return hit && Date.now() - hit.at < 10 * 60_000 ? structuredClone(hit.card) : null;
}
function rememberCard(key: string, card: AnswerCard) {
  cardCache.set(key, { at: Date.now(), card: structuredClone(card) });
  if (cardCache.size > 100) cardCache.delete(cardCache.keys().next().value!);
}

/** No raw HTML reaches the dialog: tags are dropped (markdown stays). */
const stripHtml = (s: string) => s.replace(/<\/?[a-z][^>]*>/gi, "").replace(/&lt;script/gi, "");

/** A small model sometimes says a sentence twice, or opens with the headline again: keep each sentence once. */
function dedupeSentences(md: string, headline: string): string {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const seen = new Set([key(headline)]);
  const out = md.split("\n").map((line) => line.split(/(?<=[.!?])\s+/).filter((s) => {
    const k = key(s);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(" ")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || md;
}

/** Console actions that fit the data when the composer proposes none: filter to the leading zone, department or taluk. */
function defaultActions(p: Presentation, results: ToolResult[]): Partial<ConsoleAction>[] {
  const out: Partial<ConsoleAction>[] = [];
  const ds = p.chart ? p.datasets.find((d) => d.id === p.chart!.dataset) : null;
  if (ds?.drill && ds.rows.length) {
    const y = p.chart!.y[0];
    const top = [...ds.rows].sort((a, b) => Number(b[y] ?? 0) - Number(a[y] ?? 0))[0];
    const v = top?.[ds.drill.field];
    if (v != null) out.push({ action: ds.drill.action, zone: ds.drill.action === "filter_zone" ? Number(v) : null, dept: ds.drill.action === "filter_dept" ? String(v) : null,
      taluk: ds.drill.action === "filter_taluk" ? String(v) : null });
  }
  const id = results.flatMap((r) => r.incidentIds)[0];
  if (id) out.push({ action: "open_incident", id });
  if (results.some((r) => r.tool === "developing_stories")) out.push({ action: "open_story" });
  return out;
}

// ------------------------------------------------------------ chart edits --

async function chartEdit(i: ChatInput, route: Route, lang: Lang, names: RefNames, now: string, sessionId: string): Promise<{ card: AnswerCard; tools: unknown[] } | null> {
  let prev = i.replyTo ? await messagePayload(i.user, i.replyTo) : null;
  if (!(prev?.payload as AnswerCard | undefined)?.datasets?.length) prev = await lastCardWithData(i.user, sessionId);
  const card = prev?.payload as AnswerCard | undefined;
  if (!card?.datasets?.length) return null;
  const fromRouter = route.chartEdit && (route.chartEdit.type || route.chartEdit.showOnMap) ? route.chartEdit : null;
  const edit = fromRouter ?? editFromText(i.message) ?? { type: null, showOnMap: false };
  const base: AnswerCard = { ...card, id: "", language: lang, sources: { ...card.sources, models: [], tools: card.sources.tools }, autoActions: [], download: null };
  const from = card.chart ?? (card.table ? { ...spec({ type: "table", dataset: card.table, title: card.headline }) } : null);
  if (!from) return null;
  let target: ChartType | null = edit.type;
  if (edit.showOnMap) {
    const geoDs = card.datasets.find((d) => allowedTypes(d).some((t) => t.startsWith("map")));
    if (geoDs) {
      const mapType = allowedTypes(geoDs).find((t) => t.startsWith("map"))!;
      const next = checkChart({ ...from, dataset: geoDs.id, type: mapType }, card.datasets, null).spec;
      if (next) return { card: editedCard(base, next, lang, "map"), tools: prev?.plan?.tools ?? [] };
    }
    // no places in this data: the same measure by zone, from the zones tool
    const scope = card.scope ?? route.scope;
    const zones = await runTool("zones", { scope: i.lockDept ? { ...scope, dept: i.lockDept } : scope });
    const p = presentAll([zones], route.normalized, lang);
    const y = ["severe", "open", "complaints", "n"].find((k) => from.y.includes(k)) ?? "score";
    const yLabel = p.datasets.find((d) => d.id === p.chart!.dataset)?.fields.find((f) => f.key === y)?.label ?? y;
    const next = checkChart({ ...p.chart!, type: "map_zones", y: [y], title: `${yLabel} by zone` }, p.datasets, null).spec;
    if (!next) return null;
    const out = editedCard({ ...base, datasets: p.datasets, scope: zones.scope, scopeLine: describeScope(zones.scope!, names, lang, now) }, next, lang, "map");
    out.sources.tools = [...card.sources.tools, { name: "zones", args: { scope }, ms: 0 }];
    return { card: out, tools: [...(prev?.plan?.tools ?? []), { name: "zones", args: { scope } }] };
  }
  if (!target) return null;
  if (target === "table") return { card: { ...editedCard(base, null, lang, "table"), table: from.dataset }, tools: prev?.plan?.tools ?? [] };
  const next = checkChart({ ...from, type: target }, card.datasets, null);
  if (!next.spec) return null;
  const out = editedCard(base, next.spec, lang, next.spec.type.startsWith("map") ? "map" : "chart");
  if (next.spec.type !== target) out.caveats = [...out.caveats, { en: `A ${target.replace("_", " ")} does not fit this data, so it stays a ${next.spec.type.replace("_", " ")}.`,
    ta: `இந்தத் தரவுக்கு ${target} பொருந்தாது; ${next.spec.type} ஆகவே காட்டப்படுகிறது.`, tanglish: `Indha data-ku ${target} fit aagaadhu; ${next.spec.type} aagave kaatturen.` }[lang]];
  if (next.fixes.length) out.sources.limits = [...out.sources.limits, `Chart checker: ${next.fixes.join("; ")}.`];
  return { card: out, tools: prev?.plan?.tools ?? [] };
}

const WHAT: Record<string, string> = { horizontal_bar: "bar chart", bar: "column chart", grouped_bar: "grouped bar chart", line: "line chart", area: "area chart", donut: "donut",
  stacked_bar: "stacked bar chart", heatmap: "heat map", table: "table" };

function editedCard(base: AnswerCard, chart: ChartSpec | null, lang: Lang, display: AnswerCard["display"]): AnswerCard {
  const type = chart?.type ?? "table";
  const headline = type.startsWith("map")
    ? { en: "The same measure, on the zone map", ta: "அதே அளவீடு, மண்டல வரைபடத்தில்", tanglish: "Adhe measure, zone map-la" }[lang]
    : { en: `Same data, as a ${WHAT[type] ?? type.replace(/_/g, " ")}`, ta: `அதே தரவு, ${WHAT[type] ?? type} வடிவில்`, tanglish: `Adhe data, ${WHAT[type] ?? type}-a` }[lang];
  // a chart edit ("make it a pie", "show on map") is a request for the picture
  return { ...base, kind: "answer", display, chart, headline, answerMarkdown: base.answerMarkdown, voiceSummary: headline, followUps: base.followUps, visualAsked: true };
}

// ------------------------------------------------------------------- bulk --

function bulkFinish(card: AnswerCard, route: Route, names: RefNames, lang: Lang, message: string, p: Presentation): AnswerCard {
  const only = { en: (x: string) => `${x} only`, ta: (x: string) => `${x} மட்டும்`, tanglish: (x: string) => `${x} mattum` }[lang];
  const zones = p.datasets.find((d) => d.id === "zones")?.rows ?? [];
  const depts = p.datasets.find((d) => d.id === "departments")?.rows ?? [];
  const topZone = [...zones].sort((a, b) => Number(b.n ?? 0) - Number(a.n ?? 0))[0];
  const topDept = [...depts].sort((a, b) => Number(b.n ?? 0) - Number(a.n ?? 0))[0];
  const chips = [
    route.scope.period !== "daily" ? { en: "Last 24 hours only", ta: "கடந்த 24 மணி நேரம் மட்டும்", tanglish: "Last 24 hours mattum" }[lang] : null,
    topZone ? only(`${topZone.name}`) : null, topDept ? only(`${topDept.name}`) : null,
    { en: "Severe incidents only", ta: "கடுமையான சம்பவங்கள் மட்டும்", tanglish: "Severe incidents mattum" }[lang]
  ].filter(Boolean) as string[];
  const out = { ...card, chips };
  if (/export|download|csv|excel|ஏற்றுமதி/i.test(message)) {
    const s = route.scope;
    const q = new URLSearchParams({ period: s.period, ...(s.zone ? { zone: String(s.zone) } : {}), ...(s.dept ? { dept: s.dept } : {}) });
    out.download = { label: { en: `Download CSV (first ${LIMITS.exportRows.toLocaleString("en-IN")} incidents, no personal data)`,
      ta: `CSV பதிவிறக்கு (முதல் ${LIMITS.exportRows.toLocaleString("en-IN")} சம்பவங்கள், தனிப்பட்ட தரவு இல்லை)`,
      tanglish: `CSV download (first ${LIMITS.exportRows.toLocaleString("en-IN")} incidents, personal data illa)` }[lang], href: `/api/collector/assistant/export?${q}` };
  }
  void names;
  return out;
}

// ------------------------------------------------------------------- help --

async function helpAnswer(i: ChatInput, route: Route, message: string, lang: Lang, names: RefNames, now: string, models: CallInfo[]): Promise<AnswerCard> {
  const base = baseCard(lang, null, "", now);
  const topics = helpFor(`${message} ${route.normalized}`);
  if (!aiStatus().available || route.offline) {
    return { ...base, display: "text", headline: topics[0].split(":")[0], answerMarkdown: topics.join("\n\n"), voiceSummary: topics[0].slice(0, 300),
      followUps: EXAMPLES[lang].slice(0, 3) };
  }
  try {
    const r = await generateJson({
      role: "fast", name: "help", schema: ComposerSchema, lenient: ComposerLenient, system: composerSystem(lang), temperature: 0.2, maxOutputTokens: 900, user: i.user,
      abortSignal: i.signal,
      prompt: composerPrompt({ question: message, normalized: route.normalized, scopeLine: "not applicable", asOf: now, testData: "no", caveats: [], lead: "",
        facts: "none (explain from the help text in DATASETS; state no numbers that are not in it)", datasets: `help:\n${topics.join("\n")}`, suggested: "none (display text)",
        actions: "", previous: "", repair: "" })
    });
    models.push(r.info);
    const d = r.object;
    const ok = verifyNumbers([d.headline, d.answerMarkdown, d.voiceSummary], [], contextNumbers(topics.join(" "), message)).ok;
    if (!ok) throw new Error("unverified numbers in help");
    return { ...base, display: "text", headline: d.headline, answerMarkdown: stripHtml(d.answerMarkdown), voiceSummary: d.voiceSummary,
      followUps: d.followUps.slice(0, 3), consoleActions: validActions(d.consoleActions, names, lang, []) };
  } catch (e) {
    if (i.signal?.aborted) throw e;
    return { ...base, display: "text", headline: topics[0].split(":")[0], answerMarkdown: topics.join("\n\n"), voiceSummary: topics[0].slice(0, 300), followUps: EXAMPLES[lang].slice(0, 3) };
  }
}

// ---------------------------------------------------------------- planner --

async function planAndRun(i: ChatInput, route: Route, message: string, now: string, models: CallInfo[]): Promise<{ plan: QueryPlan; results: QueryResult[] }> {
  const cat = await loadCatalog();
  const catalog = renderCatalog(cat, tablesFor(`${message} ${route.normalized}`));
  let repair = "";
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await generateJson({
      role: "reasoning", name: "planner", schema: PlanSchema, system: PLANNER_SYSTEM, temperature: 0, maxOutputTokens: 1400, user: i.user, abortSignal: i.signal,
      prompt: plannerPrompt({ catalog, places: "", scope: JSON.stringify(route.scope), previous: "", question: route.normalized, asOf: now, repair })
    });
    models.push(r.info);
    const plan = r.object;
    if (!plan.queries.length) throw new CompileError(plan.unsupported ?? "The data cannot answer this question.");
    try {
      const compiled = plan.queries.slice(0, LIMITS.queriesPerQuestion).map((q) => compileQuery(i.lockDept ? lockQuery(q) : q, cat, now, i.lockDept ? { ...route.scope, dept: i.lockDept } : route.scope));
      const results: QueryResult[] = [];
      for (const c of compiled) results.push(await runCompiled(c, now));
      if (results.every((x) => !x.rows.length) && attempt < 2) {
        repair = "The plan returned no rows. Check the filters (values must match the catalog's listed values) and the time range.";
        continue;
      }
      if (plan.unsupported) plan.assumptions.push(`Not answerable as asked: ${plan.unsupported}`);
      return { plan, results };
    } catch (e) {
      if (!(e instanceof CompileError) && !(e as Row)?.sqlMessage) throw e;
      last = e as Error;
      repair = (e as Error).message.slice(0, 400);
    }
  }
  throw last ?? new CompileError("The plan could not be compiled.");
}
