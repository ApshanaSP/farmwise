/**
 * The chart checker: the model designs a chart, code decides what is drawn. Every spec is
 * fixed or rejected against its dataset before it reaches the dialog:
 *
 *   one message per chart, the finding as the title; categories sorted, top 10 plus "Others";
 *   the key mark highlighted and the rest muted; faded previous-period marks and a normal band
 *   only when the data has them; never a dual axis; no pie with more than 6 slices; lines
 *   need an ordered x; maps need places.
 *
 * chartView() turns a checked spec into the plain series the renderer draws. Pure, no server
 * imports: the dialog runs the same rules when the Collector switches the chart type.
 */
import type { Lang } from "@/lib/assistant/lang";
import { CHART_TYPES, type ChartSpec, type ChartType, type DataRow, type Dataset, type Field, type Format } from "@/lib/assistant/answer";

const CATEGORY_TYPES: ChartType[] = ["bar", "horizontal_bar", "stacked_bar", "grouped_bar", "dumbbell", "donut", "rose", "treemap"];
const LINE_TYPES: ChartType[] = ["line", "area", "small_multiples"];
const MAP_TYPES: ChartType[] = ["map_zones", "map_wards", "map_points", "map_hotspots"];
/** Panels in a small-multiples grid: one per group, the largest few. */
export const MAX_PANELS = 6;
export const MAX_SLICES = 6;
export const MAX_CATEGORIES = 10;
export const MAX_LINES = 4;

const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const field = (ds: Dataset, key: string | null | undefined): Field | undefined => (key ? ds.fields.find((f) => f.key === key) : undefined);
const valueFields = (ds: Dataset) => ds.fields.filter((f) => f.kind === "value");
const hasGeo = (ds: Dataset, ...keys: string[]) => keys.every((k) => ds.fields.some((f) => f.key === k));

/** Chart types that make sense for a dataset, for the type switch. */
export function allowedTypes(ds: Dataset): ChartType[] {
  const time = ds.fields.find((f) => f.kind === "time");
  const x = time ?? ds.fields.find((f) => f.kind === "category");
  const values = valueFields(ds);
  const out: ChartType[] = ["table"];
  if (values.length) out.push("kpi");
  if (x && values.length) {
    if (x.kind === "time") {
      out.push("line", "area", "bar");
      // over time and by group (weekly counts per ward): one line per group, or a heat map when there are many
      if (ds.fields.some((f) => f.kind === "category")) out.push("small_multiples", "stacked_bar", "heatmap");
    } else {
      out.push("horizontal_bar", "bar");
      const nonNeg = values.some((v) => ds.rows.every((r) => (num(r[v.key]) ?? 0) >= 0));
      if (ds.rows.length >= 2 && nonNeg) out.push("donut");
      // a rose for a handful of categories, a treemap for a share across many
      if (ds.rows.length >= 3 && ds.rows.length <= 12 && nonNeg) out.push("rose");
      if (ds.rows.length >= 4 && nonNeg) out.push("treemap");
      if (values.length >= 2) out.push("grouped_bar", "stacked_bar");
      // this period against the previous one, per category
      if (ds.hasPrev && values.some((v) => ds.fields.some((f) => f.key === `${v.key}_prev`))) out.push("dumbbell");
    }
  }
  // one reading on a known scale (a percentage, a warning level): a gauge
  if (ds.rows.length === 1 && values.some((v) => v.format === "percent" || v.unit === "%")) out.push("gauge");
  if (hasGeo(ds, "zone") && values.length) out.push("map_zones");
  if (ds.fields.some((f) => f.key === "ward" || f.key === "ward_no") && values.length) out.push("map_wards");
  if (hasGeo(ds, "lat", "lon")) out.push(ds.id === "hotspots" ? "map_hotspots" : "map_points");
  return out;
}

/**
 * The picture for one of an answer's other datasets, when the Collector switches views on the card: located records
 * on the map, a series over time as an area, a ranking as bars; null when only a table fits.
 */
export function defaultSpec(ds: Dataset, datasets: Dataset[], like: ChartSpec | null = null): ChartSpec | null {
  const time = ds.fields.find((f) => f.kind === "time");
  const cat = ds.fields.find((f) => f.kind === "category");
  const y = valueFields(ds).find((f) => !f.key.endsWith("_prev"))?.key;
  const points = hasGeo(ds, "lat", "lon") && (!cat || /point|hotspot|incident/.test(ds.id));
  const type: ChartType = points ? (ds.id === "hotspots" ? "map_hotspots" : "map_points") : time && y ? "area" : cat && y ? "horizontal_bar" : "table";
  if (type === "table" || !allowedTypes(ds).includes(type)) return null;
  const label = ds.fields.find((f) => f.key === "title" || f.key === "place" || f.key === "name")?.key ?? cat?.key ?? null;
  return checkChart({ type, dataset: ds.id, title: ds.title, subtitle: like?.subtitle ?? null, x: points ? label : time?.key ?? cat?.key ?? null, y: y ? [y] : [],
    series: null, compare: false, normalBand: !!ds.normal, threshold: null, highlight: time ? "last" : "max", callout: true, sort: time ? "none" : "desc", topN: 10, labels: [] },
  datasets).spec;
}

export interface Checked { spec: ChartSpec | null; fixes: string[] }

/**
 * Fix or reject a chart spec. `fallback` is the code's own default for the data; it is used
 * when the proposed spec cannot be drawn.
 */
export function checkChart(input: Partial<ChartSpec> | null | undefined, datasets: Dataset[], fallback: ChartSpec | null = null): Checked {
  const fixes: string[] = [];
  if (!input) return fallback ? checkChart(fallback, datasets, null) : { spec: null, fixes };
  const ds = datasets.find((d) => d.id === input.dataset);
  if (!ds) {
    fixes.push(`unknown dataset ${input.dataset}`);
    return fallback && fallback !== input ? { spec: checkChart(fallback, datasets, null).spec, fixes } : { spec: null, fixes };
  }
  let type: ChartType = (CHART_TYPES as readonly string[]).includes(String(input.type)) ? (input.type as ChartType) : "table";
  if (type !== input.type) fixes.push(`unsupported type ${input.type}`);
  if (!allowedTypes(ds).includes(type)) {
    const alt = allowedTypes(ds).find((t) => t !== "table" && t !== "kpi") ?? "table";
    fixes.push(`${type} does not fit ${ds.id}; using ${alt}`);
    type = alt;
  }

  // x: an ordered axis for lines, a category otherwise
  let x = input.x ?? null;
  const xf = field(ds, x);
  const wantKind = LINE_TYPES.includes(type) ? ["time"] : ["category", "time"];
  if (!MAP_TYPES.includes(type) && type !== "kpi" && type !== "table" && (!xf || !wantKind.includes(xf.kind))) {
    const alt = ds.fields.find((f) => wantKind.includes(f.kind));
    if (xf || x) fixes.push(`x ${x} replaced`);
    x = alt?.key ?? null;
  }

  // y: known value fields sharing one unit and format (never a dual axis)
  let y = (input.y ?? []).filter((k) => field(ds, k)?.kind === "value");
  if (!y.length) {
    const first = valueFields(ds)[0];
    if (first) y = [first.key];
    if ((input.y ?? []).length) fixes.push("y replaced by a known value field");
  }
  if (y.length > 1) {
    const f0 = field(ds, y[0])!;
    const same = y.filter((k) => { const f = field(ds, k)!; return (f.unit ?? null) === (f0.unit ?? null) && (f.format ?? null) === (f0.format ?? null); });
    if (same.length < y.length) fixes.push("dropped value fields in another unit (no dual axis)");
    y = same;
  }
  if (["donut", "rose", "treemap", "gauge"].includes(type) && y.length > 1) { y = y.slice(0, 1); fixes.push(`a ${type} shows one measure`); }
  if (["grouped_bar", "stacked_bar"].includes(type) && y.length < 2 && !input.series) {
    type = "horizontal_bar";
    fixes.push("one measure: a plain bar");
  }

  let series = input.series ?? null;
  if (series && field(ds, series)?.kind !== "category") { series = null; fixes.push("series field dropped"); }
  // small multiples: one panel per group; a tangle of more than MAX_LINES lines becomes small multiples
  if (type === "small_multiples" && !series) series = ds.fields.find((f) => f.kind === "category" && f.key !== x)?.key ?? null;
  if (type === "small_multiples" && !series) { type = "line"; fixes.push("small multiples need groups; a single line"); }
  if (LINE_TYPES.includes(type) && type !== "small_multiples" && series && new Set(ds.rows.map((r) => String(r[series!]))).size > MAX_LINES) {
    type = "small_multiples";
    fixes.push(`more than ${MAX_LINES} lines: small multiples`);
  }
  if (type === "heatmap" && !series) { type = x && field(ds, x)?.kind === "time" ? "line" : "horizontal_bar"; fixes.push("heatmap needs rows and columns"); }

  const isTime = field(ds, x)?.kind === "time";
  const sort: ChartSpec["sort"] = isTime || LINE_TYPES.includes(type) ? "none" : input.sort === "asc" ? "asc" : "desc";
  const topN = type === "donut" ? MAX_SLICES - 1 : type === "rose" ? 8 : type === "treemap" ? 15 : Math.max(3, Math.min(MAX_CATEGORIES, Math.round(Number(input.topN) || MAX_CATEGORIES)));
  const highlight = input.highlight && String(input.highlight).trim() ? String(input.highlight) : isTime ? "last" : "max";
  const canCompare = !!ds.hasPrev && y.every((k) => ds.fields.some((f) => f.key === `${k}_prev`));
  if (type === "dumbbell" && !canCompare) { type = "horizontal_bar"; fixes.push("dumbbell needs a previous period"); }
  if (type === "dumbbell" && y.length > 1) y = y.slice(0, 1);
  const compare = canCompare && (!!input.compare || type === "dumbbell");
  const normalBand = !!input.normalBand && !!ds.normal && (LINE_TYPES.includes(type) || type === "bar");
  const t = input.threshold;
  const threshold = t && Number.isFinite(Number(t.value)) ? { value: Number(t.value), label: String(t.label ?? "").slice(0, 40) } : null;
  const title = String(input.title ?? "").trim().slice(0, 110) || defaultTitle(ds, y, x);
  if (!String(input.title ?? "").trim()) fixes.push("title added");
  const labels = (input.labels ?? []).filter((l) => l && l.from && l.to).slice(0, 60).map((l) => ({ from: String(l.from), to: String(l.to).slice(0, 60) }));

  return {
    spec: { type, dataset: ds.id, title, subtitle: input.subtitle ? String(input.subtitle).slice(0, 140) : null, x, y, series, compare, normalBand, threshold,
      highlight, callout: input.callout !== false, sort, topN, labels },
    fixes
  };
}

function defaultTitle(ds: Dataset, y: string[], x: string | null) {
  const yl = field(ds, y[0])?.label ?? "Value";
  const xl = field(ds, x)?.label;
  return xl ? `${yl} by ${xl.toLowerCase()}` : ds.title;
}

/**
 * The chart that suits this data and question, instead of one bar chart for everything: shares become a donut
 * (few parts) or a treemap (many), a short list a column chart, a small mix a rose, a single percentage a gauge,
 * a series over time a filled area, a ranking a horizontal bar. The model may still choose; this is the code's default.
 */
export function bestType(spec: ChartSpec, ds: Dataset, question: string): ChartType {
  const ok = allowedTypes(ds);
  const want = (t: ChartType) => ok.includes(t);
  const q = question.toLowerCase();
  const n = ds.rows.length;
  if (MAP_TYPES.includes(spec.type) || spec.type === "heatmap" || spec.type === "small_multiples" || spec.type === "dumbbell") return spec.type;
  if (want("gauge") && n === 1) return "gauge";
  const xf = field(ds, spec.x);
  if (xf?.kind === "time") return spec.series ? (want("small_multiples") && new Set(ds.rows.map((r) => String(r[spec.series!]))).size > MAX_LINES ? "small_multiples" : "line")
    : want("area") ? "area" : spec.type;
  const share = /share|mix|split|composition|breakdown|proportion|distribution|percent|பங்கு|பகிர்வு|விகிதம்/.test(q);
  const compare = /compare|previous|last (week|month)|change|\bvs\b|versus|than before|மாற்றம்|ஒப்பிடு/.test(q);
  if (compare && want("dumbbell") && n <= 12) return "dumbbell";
  if (share && n <= MAX_SLICES && want("donut")) return "donut";
  if (share && want("treemap")) return "treemap";
  if (/spread|pattern|profile|mix|பரவல்/.test(q) && want("rose") && n >= 4 && n <= 8) return "rose";
  if (n <= 6 && want("bar") && spec.type === "horizontal_bar") return "bar";
  return spec.type;
}

/** Switch a checked chart to another type, running the same rules. */
export function switchType(spec: ChartSpec, type: ChartType, datasets: Dataset[]): ChartSpec {
  return checkChart({ ...spec, type }, datasets, spec).spec ?? spec;
}

// ------------------------------------------------------------------- view --

export interface ViewSeries { key: string; name: string; values: (number | null)[]; prev: (number | null)[] | null; format: Format; unit: string | null }
export interface ChartView {
  type: ChartType;
  title: string;
  subtitle: string | null;
  categories: string[];
  /** raw x values, for drill-down */
  keys: (string | number | null)[];
  series: ViewSeries[];
  highlight: number[];
  band: { lo: number; hi: number; label: string } | null;
  threshold: { value: number; label: string } | null;
  callouts: { index: number; series: number; text: string }[];
  heat: { xs: string[]; ys: string[]; cells: [number, number, number][]; max: number } | null;
  /** categories folded into "Others" */
  others: number;
  otherLabel: string;
}

const OTHERS: Record<Lang, string> = { en: "Others", ta: "மற்றவை", tanglish: "Others" };

/** The series the renderer draws for a checked spec. */
export function chartView(spec: ChartSpec, ds: Dataset, lang: Lang = "en"): ChartView {
  const tr = new Map(spec.labels.map((l) => [l.from, l.to]));
  const label = (v: unknown) => { const s = v == null ? "—" : String(v); return tr.get(s) ?? s; };
  const yf = spec.y.map((k) => ds.fields.find((f) => f.key === k)!).filter(Boolean);
  const base: ChartView = { type: spec.type, title: spec.title, subtitle: spec.subtitle, categories: [], keys: [], series: [], highlight: [], band: null,
    threshold: spec.threshold, callouts: [], heat: null, others: 0, otherLabel: OTHERS[lang] };
  if (!yf.length || spec.type === "table" || MAP_TYPES.includes(spec.type)) return base;

  if (spec.type === "heatmap" && spec.series && spec.x) {
    const xs = [...new Set(ds.rows.map((r) => String(r[spec.x!])))];
    const totals = new Map<string, number>();
    for (const r of ds.rows) totals.set(String(r[spec.series]), (totals.get(String(r[spec.series])) ?? 0) + (num(r[yf[0].key]) ?? 0));
    const ys = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CATEGORIES).map(([k]) => k);
    const cells: [number, number, number][] = [];
    for (const r of ds.rows) {
      const xi = xs.indexOf(String(r[spec.x])), yi = ys.indexOf(String(r[spec.series]));
      if (xi >= 0 && yi >= 0) cells.push([xi, yi, num(r[yf[0].key]) ?? 0]);
    }
    return { ...base, categories: xs.map(label), keys: xs, heat: { xs: xs.map(label), ys: ys.map(label), cells, max: Math.max(0, ...cells.map((c) => c[2])) },
      others: Math.max(0, totals.size - ys.length) };
  }

  // multi-line: one series per value of `series`, the largest few only
  if (spec.series && (LINE_TYPES.includes(spec.type) || ["stacked_bar", "grouped_bar"].includes(spec.type)) && spec.x) {
    const xs = [...new Set(ds.rows.map((r) => r[spec.x!] as string | number | null))];
    const totals = new Map<string, number>();
    for (const r of ds.rows) totals.set(String(r[spec.series]), (totals.get(String(r[spec.series])) ?? 0) + (num(r[yf[0].key]) ?? 0));
    const keep = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, spec.type === "small_multiples" ? MAX_PANELS : LINE_TYPES.includes(spec.type) ? MAX_LINES : MAX_SLICES).map(([k]) => k);
    const series: ViewSeries[] = keep.map((sk) => ({
      key: sk, name: label(sk), prev: null, format: yf[0].format ?? "integer", unit: yf[0].unit ?? null,
      values: xs.map((xv) => num(ds.rows.find((r) => r[spec.x!] === xv && String(r[spec.series!]) === sk)?.[yf[0].key]))
    }));
    const hi = highlightIndex(spec, xs, series[0]?.values ?? []);
    return { ...base, categories: xs.map(label), keys: xs, series, highlight: hi, others: Math.max(0, totals.size - keep.length),
      band: bandOf(spec, ds), callouts: callouts(spec, hi, series) };
  }

  // one row per category (or time bucket)
  let rows: DataRow[] = [...ds.rows];
  const y0 = yf[0].key;
  if (spec.sort !== "none") rows.sort((a, b) => ((num(b[y0]) ?? -Infinity) - (num(a[y0]) ?? -Infinity)) * (spec.sort === "asc" ? -1 : 1));
  let others = 0;
  let otherRow: DataRow | null = null;
  const isCategory = spec.x && ds.fields.find((f) => f.key === spec.x)?.kind === "category";
  if (isCategory && rows.length > spec.topN + 1 && spec.type !== "kpi") {
    const rest = rows.slice(spec.topN);
    others = rest.length;
    otherRow = { [spec.x!]: OTHERS[lang] };
    for (const f of yf) {
      const additive = f.format !== "percent" && f.format !== "decimal1" && f.format !== "decimal2";
      otherRow[f.key] = additive ? rest.reduce((s, r) => s + (num(r[f.key]) ?? 0), 0) : null;
      if (ds.hasPrev) otherRow[`${f.key}_prev`] = additive ? rest.reduce((s, r) => s + (num(r[`${f.key}_prev`]) ?? 0), 0) : null;
    }
    // an "Others" bar of zero is noise: leave it out (the categories still count as folded)
    const empty = yf.every((f) => otherRow![f.key] == null || Number(otherRow![f.key]) === 0);
    rows = [...rows.slice(0, spec.topN), ...(empty ? [] : [otherRow])];
    if (empty) otherRow = null;
  }
  const keys = rows.map((r) => (spec.x ? (r[spec.x] as string | number | null) : null));
  const categories = rows.map((r, i) => (r === otherRow ? OTHERS[lang] : label(keys[i])));
  const series: ViewSeries[] = yf.map((f) => ({
    key: f.key, name: label(f.label), format: f.format ?? "integer", unit: f.unit ?? null,
    values: rows.map((r) => num(r[f.key])),
    prev: spec.compare ? rows.map((r) => num(r[`${f.key}_prev`])) : null
  }));
  const hi = highlightIndex(spec, keys, series[0].values);
  return { ...base, categories, keys, series, highlight: hi, others, band: bandOf(spec, ds), callouts: callouts(spec, hi, series) };
}

function highlightIndex(spec: ChartSpec, keys: (string | number | null)[], values: (number | null)[]): number[] {
  const h = spec.highlight;
  if (h === "none" || !values.length) return [];
  if (h === "last") return [values.length - 1];
  if (h === "max" || h === "min") {
    let best = -1;
    values.forEach((v, i) => { if (v != null && (best < 0 || (h === "max" ? v > (values[best] ?? -Infinity) : v < (values[best] ?? Infinity)))) best = i; });
    return best < 0 ? [] : [best];
  }
  const i = keys.findIndex((k) => String(k).toLowerCase() === h.toLowerCase());
  return i < 0 ? [] : [i];
}

function bandOf(spec: ChartSpec, ds: Dataset) {
  return spec.normalBand && ds.normal ? { lo: ds.normal.lo, hi: ds.normal.hi, label: ds.normal.basis } : null;
}

function callouts(spec: ChartSpec, hi: number[], series: ViewSeries[]) {
  if (!spec.callout || !hi.length || !series.length) return [];
  const v = series[0].values[hi[0]];
  return v == null ? [] : [{ index: hi[0], series: 0, text: fmtValue(v, series[0].format, series[0].unit) }];
}

// ----------------------------------------------------------------- format --

/** Indian digit grouping (1,23,456), rupees, percentages. */
export function fmtValue(v: number | null | undefined, format: Format = "integer", unit: string | null = null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const g = (d: number) => v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  switch (format) {
    case "percent": return `${g(Math.abs(v) < 10 && v % 1 ? 1 : 0)}%`;
    case "rupee": return `₹${g(v % 1 ? 2 : 0)}`;
    case "decimal1": return `${g(1)}${unit && unit !== "%" ? ` ${unit}` : unit === "%" ? "%" : ""}`;
    case "decimal2": return g(2);
    case "text": return String(v);
    default: return g(0);
  }
}
