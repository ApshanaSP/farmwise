/**
 * What an answer is, as the server sends it and the dialog draws it. Pure types and
 * helpers with no server imports, so the browser bundle can use them too.
 */
import type { Lang } from "@/lib/assistant/lang";

export type Period = "daily" | "weekly" | "monthly" | "quarterly";
export interface Scope { period: Period; zone: number | null; dept: string | null; cat: string | null; taluk: string | null }

// ---------------------------------------------------------------- datasets --

export type Format = "integer" | "decimal1" | "decimal2" | "percent" | "rupee" | "text";
export interface Field {
  key: string;
  label: string;
  kind: "category" | "time" | "value" | "id" | "geo" | "text";
  unit?: string | null;
  format?: Format;
  /** false when a sum over rows means nothing (outlets per incident, scores, ages) */
  additive?: boolean;
}
export type Cell = string | number | boolean | null;
export type DataRow = Record<string, Cell>;

/** A table of rows an answer draws from: every chart, map and table on a card points at one. */
export interface Dataset {
  id: string;
  title: string;
  /** short name for the card's view tabs ("Localities", "Wards", "Map") */
  tab?: string;
  fields: Field[];
  rows: DataRow[];
  /** rows before any cap (the card says "showing 20 of 312") */
  total?: number;
  /** field holding the previous period's value for each `value` field: "<key>_prev" */
  hasPrev?: boolean;
  /** the usual range for a time series (descriptive: the preceding windows, never a forecast) */
  normal?: { lo: number; hi: number; basis: string } | null;
  /** clicking a mark filters the console: which field and which action */
  drill?: { field: string; action: ConsoleActionName } | null;
  /** incident id per row, for "open incident" */
  idField?: string | null;
}

// ------------------------------------------------------------------ charts --

export const CHART_TYPES = ["bar", "horizontal_bar", "stacked_bar", "grouped_bar", "dumbbell", "line", "area", "small_multiples", "donut", "rose", "treemap", "gauge", "heatmap", "kpi",
  "table", "map_zones", "map_wards", "map_points", "map_hotspots"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSpec {
  type: ChartType;
  dataset: string;
  /** the finding, as a sentence */
  title: string;
  subtitle: string | null;
  /** category or time field */
  x: string | null;
  /** value fields; all share one unit (no dual axis) */
  y: string[];
  /** field that splits the values into series (stacked, grouped, lines, heatmap rows) */
  series: string | null;
  /** faded previous-period marks, when the dataset has them */
  compare: boolean;
  normalBand: boolean;
  threshold: { value: number; label: string } | null;
  /** "max" | "min" | "last" | "none" | a category value */
  highlight: string;
  callout: boolean;
  sort: "desc" | "asc" | "none";
  topN: number;
  /** category labels in the reply language */
  labels: { from: string; to: string }[];
}

// --------------------------------------------------------- console actions --

export const CONSOLE_ACTIONS = ["filter_zone", "filter_dept", "filter_taluk", "filter_cat", "set_period", "open_incident", "open_story",
  "open_briefing", "save_briefing", "show_on_map"] as const;
export type ConsoleActionName = (typeof CONSOLE_ACTIONS)[number];
export interface ConsoleAction {
  action: ConsoleActionName;
  label: string;
  zone?: number | null;
  dept?: string | null;
  taluk?: string | null;
  cat?: string | null;
  period?: Period | null;
  id?: string | null;
}

// ------------------------------------------------------------------- cards --

export interface Kpi { label: string; value: number; prev?: number | null; unit?: string | null; format?: Format; tone?: "sev" | "high" | "low" | "info" }

export interface AnswerSources {
  tools: { name: string; args: Record<string, unknown>; ms: number }[];
  /** the compiled SELECTs of an ad-hoc answer, with their parameters */
  sql: { text: string; params: unknown[] }[];
  plan: unknown | null;
  refs: { kind: string; name: string; detail?: string }[];
  rows: number;
  incidentIds: string[];
  models: { step: string; provider: string; model: string; ms: number; tokens: number; inTokens?: number; outTokens?: number }[];
  verifier: { checked: number; unmatched: string[]; regenerated: boolean; template: boolean };
  assumptions: string[];
  limits: string[];
}

export type Display = "chart" | "kpi" | "table" | "text" | "map";

export interface AnswerCard {
  id: string;
  kind: "answer" | "refusal" | "clarify" | "error" | "action";
  language: Lang;
  display: Display;
  headline: string;
  /** the question after typo correction, when it was corrected ("Understood as: tomato price") */
  understood?: string | null;
  /** the question asked for a chart, graph or map; otherwise the card answers in words and draws its chart only on "Visualise" */
  visualAsked?: boolean;
  /** markdown without HTML; the dialog renders it safely */
  answerMarkdown: string;
  voiceSummary: string;
  voiceLang: "en-IN" | "ta-IN";
  chart: ChartSpec | null;
  datasets: Dataset[];
  kpis: Kpi[];
  /** dataset shown as a table (list answers) */
  table: string | null;
  followUps: string[];
  /** narrowing chips (large requests) or example questions (refusals) */
  chips: string[];
  consoleActions: ConsoleAction[];
  /** console actions applied as soon as the answer arrives (the Collector asked for them) */
  autoActions: ConsoleAction[];
  /** set when the card opened one of today's insights: its 👍/👎 ranks insights */
  insightKey?: string | null;
  caveats: string[];
  scope: Scope | null;
  scopeLine: string;
  asOf: string;
  testData: boolean;
  sources: AnswerSources;
  /** a download the answer offers, e.g. a capped CSV export */
  download?: { label: string; href: string } | null;
  offline?: boolean;
}

export const emptySources = (): AnswerSources => ({
  tools: [], sql: [], plan: null, refs: [], rows: 0, incidentIds: [], models: [], verifier: { checked: 0, unmatched: [], regenerated: false, template: false },
  assumptions: [], limits: []
});
