/**
 * From tool results to what a card can draw: datasets (plain rows with typed fields), KPI
 * tiles, a table choice and the code's own default chart for the data. The model may then
 * refine the chart (title, measure, type, labels); if its spec fails the checker, the
 * default below is drawn instead. Rows carry no personal data: the tools never return it.
 */
import type { Lang } from "@/lib/assistant/lang";
import { bestType, checkChart } from "@/lib/assistant/chartspec";
import type { ToolResult } from "@/lib/assistant/types";
import type { ChartSpec, DataRow, Dataset, Display, Field, Kpi } from "@/lib/assistant/answer";
import { PERIOD_LABEL } from "@/lib/assistant/lang";

type Row = Record<string, any>;

export interface Presentation {
  datasets: Dataset[];
  chart: ChartSpec | null;
  kpis: Kpi[];
  table: string | null;
  display: Display;
}

export const spec = (p: Partial<ChartSpec> & Pick<ChartSpec, "type" | "dataset" | "title">): ChartSpec => ({
  subtitle: null, x: null, y: [], series: null, compare: false, normalBand: false, threshold: null, highlight: "max", callout: true, sort: "desc",
  topN: 10, labels: [], ...p
});

const F = {
  cat: (key: string, label: string): Field => ({ key, label, kind: "category" }),
  time: (key: string, label: string): Field => ({ key, label, kind: "time" }),
  id: (key: string, label: string): Field => ({ key, label, kind: "id" }),
  text: (key: string, label: string): Field => ({ key, label, kind: "text" }),
  geo: (key: string, label: string): Field => ({ key, label, kind: "geo" }),
  int: (key: string, label: string, unit: string | null = null): Field => ({ key, label, kind: "value", unit, format: "integer" }),
  dec: (key: string, label: string, unit: string | null = null): Field => ({ key, label, kind: "value", unit, format: "decimal1" }),
  pct: (key: string, label: string): Field => ({ key, label, kind: "value", unit: "%", format: "percent" }),
  rs: (key: string, label: string, unit = "Rs/kg"): Field => ({ key, label, kind: "value", unit, format: "rupee" })
};

const pick = (r: Row, keys: string[]): DataRow => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));
/** Which measure the question asks about, for the default chart (the model can still change it). */
function measure(q: string, options: Record<string, RegExp>, dflt: string): string {
  for (const [k, re] of Object.entries(options)) if (re.test(q)) return k;
  return dflt;
}
const SEVERE = /severe|serious|கடுமை/i, COMPLAINT = /complain|grievance|புகார்/i, OPEN = /open|pending|unresolved|backlog|நிலுவை/i;

/** "30 Aug" for daily buckets, "18:43" for 2-hour buckets, "w/e 5 Jul" for weeks. */
function bucketLabel(to: string, unit: string): string {
  const d = new Date(to.replace(" ", "T") + "+05:30");
  const day = d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
  if (unit === "2 hours") return d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
  return unit === "week" ? `w/e ${day}` : day;
}

export function present(r: ToolResult, question: string, lang: Lang): Presentation {
  const d = r.data as Row;
  const none: Presentation = { datasets: [], chart: null, kpis: [], table: null, display: "text" };
  if (!d) return none;
  const period = r.scope ? PERIOD_LABEL[r.scope.period].en.toLowerCase() : "";

  switch (r.tool) {
    case "overview_kpis": {
      const L = d.labels as Record<string, string>;
      const tone: Record<string, Kpi["tone"]> = { severe: "sev", complaints: "high", ongoing: "info", resolved: "low" };
      const kpis = Object.keys(L).map((k) => ({ label: L[k], value: Number(d.cur[k]), prev: Number(d.prev[k]), tone: tone[k] }));
      const n = (d.series.severe as number[]).length;
      const rows = Array.from({ length: n }, (_, i) => ({ bucket: i + 1, ...Object.fromEntries(Object.keys(L).map((k) => [k, Number(d.series[k][i])])) }));
      const ds: Dataset = { id: "kpi_series", title: "Headline figures over the period", fields: [F.time("bucket", "Bucket"),
        ...Object.keys(L).map((k) => F.int(k, L[k]))], rows };
      return { datasets: [ds], chart: null, kpis, table: null, display: "kpi" };
    }

    case "zones":
    case "zone_profile": {
      const ranks: Row[] = r.tool === "zones" ? d.rows : d.ranks;
      const ds: Dataset = {
        id: "zones", title: "Zones", drill: { field: "zone", action: "filter_zone" },
        fields: [F.cat("name", "Zone"), F.id("zone", "Zone number"), F.int("score", "Attention score"), F.int("severe", "Severe incidents"),
          F.int("high", "High incidents"), F.int("n", "Incidents reported"), F.int("open", "Open incidents"), F.int("complaints", "Open complaints")],
        rows: ranks.map((z) => pick(z, ["name", "zone", "score", "severe", "high", "n", "open", "complaints"]))
      };
      const y = measure(question, { severe: SEVERE, complaints: COMPLAINT, open: OPEN }, "score");
      if (r.tool === "zones") {
        const what = y === "severe" ? "severe incidents" : y === "complaints" ? "open complaints" : y === "open" ? "open incidents" : "attention score";
        return { datasets: [ds], chart: spec({ type: "horizontal_bar", dataset: "zones", x: "name", y: [y], title: `Zones by ${what}`,
          subtitle: `${d.formula}; ${period}` }), kpis: [], table: null, display: "chart" };
      }
      const top: Dataset = { id: "zone_top", title: `Top open incidents in ${d.name}`, idField: "id",
        fields: [F.id("id", "Incident"), F.text("title", "Incident"), F.cat("sev", "Severity"), F.dec("priority", "Priority score"), F.text("why", "Why it ranks high")],
        rows: (d.top as Row[]).map((i) => ({ id: i.id, title: i.title, sev: i.sev, priority: i.priority, why: [...(i.why?.what ?? []), ...(i.why?.why ?? [])].slice(0, 3).join("; ") })) };
      const row = d.row as Row | null;
      return {
        datasets: [ds, top],
        chart: spec({ type: "horizontal_bar", dataset: "zones", x: "name", y: ["score"], highlight: String(d.name), title: `${d.name} ranks ${d.rank} of ${d.of} zones`,
          subtitle: `${d.formula}; ${period}`, topN: 15 }),
        kpis: [{ label: `Attention rank (of ${d.of})`, value: Number(d.rank), tone: "info" }, { label: "Attention score", value: Number(row?.score ?? 0) },
          { label: "Severe", value: Number(row?.severe ?? 0), tone: "sev" }, { label: "High", value: Number(row?.high ?? 0), tone: "high" }],
        table: "zone_top", display: "chart"
      };
    }

    case "departments": {
      const ds: Dataset = { id: "departments", title: "Departments", drill: { field: "code", action: "filter_dept" },
        fields: [F.cat("name", "Department"), F.id("code", "Code"), F.int("open", "Open incidents"), F.int("n", "Incidents reported"), F.int("severe", "Severe incidents"),
          F.int("unverified", "Awaiting verification")],
        rows: (d.rows as Row[]).map((x) => pick(x, ["name", "code", "open", "n", "severe", "unverified"])) };
      const y = measure(question, { severe: SEVERE, unverified: /verif|சரிபார்/i, n: /reported|total|all/i }, "open");
      const t = { severe: "Severe incidents by department", unverified: "Awaiting verification by department", n: "Incidents reported by department", open: "Open incidents by department" }[y];
      return { datasets: [ds], chart: spec({ type: "horizontal_bar", dataset: "departments", x: "name", y: [y], title: t ?? "Departments", subtitle: period }),
        kpis: [], table: null, display: "chart" };
    }

    case "severity": {
      const order = ["Severe", "High", "Medium", "Low"];
      const open: Dataset = { id: "severity_open", title: "Open incidents by severity", fields: [F.cat("sev", "Severity"), F.int("n", "Open incidents")],
        rows: order.map((s) => ({ sev: s, n: Number(d.open[s] ?? 0) })) };
      const mix: Dataset = { id: "severity_mix", title: "Reported in the period by severity", fields: [F.cat("sev", "Severity"), F.int("n", "Reported"), F.int("open", "Still open")],
        rows: (d.mix as Row[]).map((m) => ({ sev: m.sev, n: m.n, open: m.open })) };
      const list: Dataset = { id: "severity_rows", title: "Top open incidents", idField: "id",
        fields: [F.id("id", "Incident"), F.text("title", "Incident"), F.cat("sev", "Severity"), F.text("zone_name", "Zone"), F.text("dept_name", "Department"), F.dec("priority", "Priority")],
        rows: (d.rows as Row[]).slice(0, 20).map((i) => pick(i, ["id", "title", "sev", "zone_name", "dept_name", "priority"])), total: (d.rows as Row[]).length };
      return { datasets: [open, mix, list], chart: spec({ type: "donut", dataset: "severity_open", x: "sev", y: ["n"], sort: "none", highlight: "Severe",
        title: "Open incidents by severity", subtitle: period }), kpis: [], table: null, display: "chart" };
    }

    case "verification_queue": {
      const ds: Dataset = { id: "tasks", title: "Awaiting your verification", idField: "id", total: Number(d.count),
        fields: [F.id("id", "Incident"), F.text("title", "Complaint"), F.text("zone_name", "Zone"), F.text("dept_name", "Department"), F.cat("sev", "Severity"),
          F.text("action_step", "Officer reported"), F.text("action_at", "Reported at")],
        rows: (d.rows as Row[]).map((i) => pick(i, ["id", "title", "zone_name", "dept_name", "sev", "action_step", "action_at"])) };
      return { datasets: [ds], chart: null, kpis: [{ label: "Awaiting your verification", value: Number(d.count), tone: "high" }], table: "tasks", display: "table" };
    }

    case "dept_backlog": {
      const ds: Dataset = { id: "backlog", title: "Average age of open incidents", drill: { field: "code", action: "filter_dept" },
        fields: [F.cat("name", "Department"), F.id("code", "Code"), F.int("days", "Average days open", "days"), F.dec("hours", "Average hours open", "hours"),
          F.int("n", "Open incidents"), F.int("overdue", "Open past deadline")],
        rows: (d.rows as Row[]).map((x) => pick(x, ["name", "code", "days", "hours", "n", "overdue"])) };
      return { datasets: [ds], chart: spec({ type: "horizontal_bar", dataset: "backlog", x: "name", y: ["days"], title: "Departments by average age of open incidents",
        subtitle: "Departments with 5 or more open incidents" }), kpis: [], table: null, display: "chart" };
    }

    case "incidents":
    case "search": {
      const rows: Row[] = r.tool === "search" ? d.incidents : d.rows;
      const ds: Dataset = { id: "incidents", title: "Incidents", idField: "id", total: r.tool === "incidents" ? Number(d.total) : rows.length,
        fields: [F.id("id", "Incident"), F.text("title", "Incident"), F.text("zone_name", "Zone"), F.text("dept_name", "Department"), F.cat("sev", "Severity"),
          F.text("status", "Status"), F.text("t", "Reported")],
        rows: rows.map((i) => pick(i, ["id", "title", "zone_name", "dept_name", "sev", "status", "t"])) };
      return { datasets: [ds], chart: null, kpis: r.tool === "incidents" ? [{ label: "Incidents matching", value: Number(d.total) }] : [], table: "incidents", display: "table" };
    }

    case "incident_detail":
    case "incident_story": {
      if (!d.incident) return none;
      const i = d.incident as Row;
      // the incident itself, one row the composer reads to tell the story (the card shows it as the record)
      const rec: Dataset = { id: "incident", title: d.confident === false ? "The closest record (no clear match)" : "The incident", tab: "Incident", idField: "id",
        fields: [F.id("id", "Incident"), F.text("title", "Title"), F.text("type", "Type"), F.text("place", "Place"), F.text("zone_name", "Zone"), F.text("t", "First reported"),
          F.text("sev", "Severity"), F.text("status", "Status"), F.text("dept_name", "Department"), F.text("summary", "Summary"), F.text("why", "Why it matters")],
        rows: [{ ...pick(i, ["id", "title", "type", "place", "zone_name", "t", "sev", "status", "dept_name", "summary"]),
          why: [...(i.why?.what ?? []), ...(i.why?.why ?? [])].slice(0, 4).join("; ") || null }] };
      const reports: Dataset = { id: "reports", title: "How it was reported, in time order", tab: "Timeline",
        fields: [F.text("t", "Time"), F.cat("what", "Report"), F.text("title", "Title"), F.text("publisher", "Outlet")],
        rows: (d.reports as Row[]).map((x) => pick(x, ["t", "what", "title", "publisher"])) };
      const others: Dataset | null = (d.others as Row[] | undefined)?.length ? { id: "others", title: "Other close matches", tab: "Similar", idField: "id",
        fields: [F.id("id", "Incident"), F.text("title", "Title"), F.text("zone_name", "Zone"), F.text("t", "First reported"), F.cat("sev", "Severity"), F.text("status", "Status")],
        rows: (d.others as Row[]).map((x) => pick(x, ["id", "title", "zone_name", "t", "sev", "status"])) } : null;
      return { datasets: [rec, reports, ...(others ? [others] : [])], chart: null, kpis: [], table: "reports", display: "text" };
    }

    case "briefing": {
      const st = d.stats as Row;
      const ds: Dataset = { id: "attention", title: "Needs your attention", idField: "id",
        fields: [F.id("id", "Incident"), F.text("title", "Incident"), F.cat("sev", "Severity"), F.text("zone", "Zone"), F.text("dept", "Department"), F.text("status", "Status")],
        rows: (d.attention as Row[]).map((a) => pick(a, ["id", "title", "sev", "zone", "dept", "status"])) };
      return { datasets: [ds], chart: null, table: "attention", display: "kpi",
        kpis: [{ label: "Reported", value: Number(st.reported), prev: null }, { label: "Still open", value: Number(st.open), tone: "info" },
          { label: "Past deadline", value: Number(st.overdue), tone: "sev" }, { label: "Severe", value: Number(st.severe), tone: "sev" }] };
    }

    case "dept_followups": {
      const ds: Dataset = { id: "followups", title: "Department follow-ups", drill: { field: "code", action: "filter_dept" },
        fields: [F.cat("name", "Department"), F.id("code", "Code"), F.int("open", "Open incidents"), F.int("overdue", "Past deadline"), F.int("serious", "Severe or high"),
          F.int("awaiting", "Awaiting verification")],
        rows: (d.rows as Row[]).map((x) => pick(x, ["name", "code", "open", "overdue", "serious", "awaiting"])) };
      return { datasets: [ds], chart: spec({ type: "horizontal_bar", dataset: "followups", x: "name", y: ["overdue"], title: "Open incidents past their deadline, by department",
        subtitle: period }), kpis: [], table: null, display: "chart" };
    }

    case "news_gaps": {
      const ds: Dataset = { id: "gaps", title: "In the news, no department record", idField: "id", total: Number(d.count),
        fields: [F.id("id", "Incident"), F.text("title", "Headline"), F.text("zone_name", "Zone"), F.text("dept_name", "Department"), F.cat("sev", "Severity"),
          { ...F.int("outlets", "Outlets"), additive: false }, F.text("t", "First reported")],
        rows: (d.rows as Row[]).map((i) => pick(i, ["id", "title", "zone_name", "dept_name", "sev", "outlets", "t"])) };
      return { datasets: [ds], chart: null, kpis: [{ label: `In the news, no department record (${d.window_days} days)`, value: Number(d.count), tone: "high" }],
        table: "gaps", display: "table" };
    }

    case "category_trends": {
      const long = (t: Row, key: string): Dataset => ({
        id: `trends_${key}`, title: key === "weekly" ? "Incidents per week by category" : "Incidents per month by category",
        fields: [F.time("t", key === "weekly" ? "Week starting" : "Month"), F.cat("category", "Category"), F.int("n", "Incidents")],
        rows: (t.lines as Row[]).flatMap((l) => (t.keys as string[]).map((k, i) => ({ t: k, category: l.label, n: Number(l.values[i]) })))
      });
      return { datasets: [long(d.weekly, "weekly"), long(d.monthly, "monthly")], chart: spec({ type: "line", dataset: "trends_weekly", x: "t", y: ["n"], series: "category",
        highlight: "last", sort: "none", title: "Weekly incidents, largest categories", subtitle: "Last 12 complete weeks" }), kpis: [], table: null, display: "chart" };
    }

    case "taluks": {
      const ds: Dataset = { id: "taluks", title: "Taluks, last 30 days", hasPrev: true, drill: { field: "code", action: "filter_taluk" },
        fields: [F.cat("name", "Taluk"), F.id("code", "Code"), F.int("open", "Open incidents"), F.int("severe", "Open severe"), F.int("overdue", "Open past deadline"),
          F.int("reported", "Reported, last 30 days"), F.int("reported_prev", "Reported, 30 days before")],
        rows: (d.rows as Row[]).map((t) => ({ name: t.name, code: t.code, open: t.open, severe: t.severe, overdue: t.overdue, reported: t.reported, reported_prev: t.prev })) };
      const y = measure(question, { severe: SEVERE, reported: /report|new|rise|trend/i }, "open");
      return { datasets: [ds], chart: spec({ type: "horizontal_bar", dataset: "taluks", x: "name", y: [y], compare: y === "reported",
        title: y === "reported" ? "Incidents reported by taluk, last 30 days against the 30 before" : "Unresolved incidents by taluk", subtitle: "Last 30 days" }),
        kpis: [], table: null, display: "chart" };
    }

    case "hotspots": {
      const ds: Dataset = { id: "hotspots", title: "Hotspots",
        fields: [F.cat("place", "Hotspot"), F.text("label", "Category"), F.geo("lat", "Latitude"), F.geo("lon", "Longitude"), F.int("incidents_30d", "Incidents, last 30 days"),
          F.int("open", "Open"), F.text("zone_name", "Zone")],
        rows: (d.rows as Row[]).map((h) => ({ place: `${h.label} – ${h.top_place}`, label: h.label, lat: h.lat, lon: h.lon, incidents_30d: h.incidents_30d, open: h.open,
          zone_name: h.zone_name ?? null })) };
      return { datasets: [ds], chart: spec({ type: "map_hotspots", dataset: "hotspots", x: "place", y: ["incidents_30d"], title: "Where incidents cluster",
        subtitle: "Hotspots with 3 or more incidents in the last 30 days" }), kpis: [], table: null, display: "map" };
    }

    case "category_summary": {
      const parts = d.parts as Row[];
      const ds: Dataset = { id: "parts", title: `By subject, ${period}`, tab: "Summary", hasPrev: true,
        fields: [F.cat("part", "Subject"), F.int("reported", "Reported"), F.int("reported_prev", "Reported, the period before"), F.int("open", "Still open"),
          F.int("severe", "Severe"), F.int("high", "High"), F.int("complaints", "Citizen complaints"), F.text("top_zone", "Most in zone"),
          { ...F.int("top_zone_n", "Incidents in that zone"), additive: false }, F.text("top_place", "Most at"), { ...F.int("top_place_n", "Incidents at that place"), additive: false }],
        rows: parts.map((p) => pick(p, ["part", "reported", "reported_prev", "open", "severe", "high", "complaints", "top_zone", "top_zone_n", "top_place", "top_place_n"])) };
      const cats: Dataset = { id: "part_categories", title: `Each category, ${period}`, tab: "Categories", hasPrev: true,
        fields: [F.cat("category", "Category"), F.text("part", "Subject"), F.int("reported", "Reported"), F.int("reported_prev", "Reported, the period before"),
          F.int("open", "Still open"), F.int("severe", "Severe")],
        rows: parts.flatMap((p) => p.categories as Row[]) };
      return { datasets: [ds, ...(cats.rows.length > parts.length ? [cats] : [])], table: "parts", display: "chart", kpis: [],
        chart: spec({ type: "horizontal_bar", dataset: "parts", x: "part", y: ["reported"], compare: true, title: "Incidents reported by subject, against the period before",
          subtitle: period }) };
    }

    case "place_breakdown": {
      const area = String(d.area);
      const counts = [F.int("n", "Incidents reported"), F.int("open", "Open"), F.int("severe", "Severe"), F.int("high", "High"), F.geo("lat", "Latitude"), F.geo("lon", "Longitude")];
      const pickCounts = (r: Row) => ({ n: r.n, open: r.open, severe: r.severe, high: r.high, lat: r.lat, lon: r.lon });
      const loc: Dataset = { id: "localities", title: d.byStreet ? `Streets and sites in ${area}` : `Localities in ${area}`, tab: d.byStreet ? "Streets" : "Localities",
        fields: [F.cat("place", d.byStreet ? "Street or site" : "Locality"), ...counts], rows: (d.localities as Row[]).map((l) => ({ place: l.key, ...pickCounts(l) })) };
      const wards: Dataset = { id: "wards", title: `Wards in ${area}`, tab: "Wards", fields: [F.cat("name", "Ward"), F.id("ward", "Ward number"), ...counts],
        rows: (d.wards as Row[]).map((w) => ({ name: w.key, ward: w.ward, ...pickCounts(w) })) };
      const types: Dataset = { id: "place_types", title: `Incident types in ${area}`, tab: "Types", drill: { field: "code", action: "filter_cat" },
        fields: [F.cat("label", "Incident type"), F.id("code", "Code"), F.int("n", "Incidents reported"), F.int("open", "Open"), F.int("severe", "Severe")],
        rows: (d.types as Row[]).map((c) => pick(c, ["label", "code", "n", "open", "severe"])) };
      const pts: Dataset = { id: "place_points", title: `Incidents on the map, ${area}`, tab: "Map", idField: "id", total: Number(d.total.n),
        fields: [F.id("id", "Incident"), F.text("title", "Incident"), F.cat("type", "Type"), F.cat("sev", "Severity"), F.text("place", "Place"),
          F.dec("priority", "Priority score"), F.geo("lat", "Latitude"), F.geo("lon", "Longitude")],
        rows: (d.points as Row[]).map((p) => pick(p, ["id", "title", "type", "sev", "place", "priority", "lat", "lon"])) };
      const y = measure(question, { severe: SEVERE, open: OPEN }, "n");
      const what = y === "severe" ? "Severe incidents" : y === "open" ? "Open incidents" : "Incidents";
      const wantMap = /\bmaps?\b|on the map|pin|plot|locate|வரைபட/i.test(question);
      const byWard = /\bwards?\b|வார்டு/i.test(question) && !d.byStreet;
      const chart = wantMap
        ? spec({ type: "map_points", dataset: "place_points", x: "title", y: ["priority"], title: `Where incidents were reported in ${area}`, subtitle: period })
        : byWard ? spec({ type: "horizontal_bar", dataset: "wards", x: "name", y: [y], title: `${what} by ward in ${area}`, subtitle: period })
          : spec({ type: "horizontal_bar", dataset: "localities", x: "place", y: [y], title: `${what} by ${d.byStreet ? "street or site" : "locality"} in ${area}`, subtitle: period });
      const T = d.total as Row;
      return {
        datasets: [loc, wards, types, pts], chart, table: "place_points", display: wantMap ? "map" : "chart",
        kpis: [{ label: `Incidents in ${area}`, value: Number(T.n) }, { label: "Open", value: Number(T.open), tone: "info" },
          { label: "Severe", value: Number(T.severe), tone: "sev" }, { label: "High", value: Number(T.high), tone: "high" }]
      };
    }

    case "unusual_rises": {
      const ds: Dataset = { id: "rises", title: "Unusual rises",
        fields: [F.cat("what", "Category, zone and day"), F.int("observed", "Reports that day"), F.dec("expected", "Usual level"), F.dec("ratio", "Times the usual level", "x")],
        rows: (d.rows as Row[]).map((e) => ({ what: `${e.label}, ${e.zone_name ?? "district"}, ${String(e.date).slice(5)}`, observed: e.observed, expected: e.expected, ratio: e.ratio })) };
      return { datasets: [ds], chart: spec({ type: "grouped_bar", dataset: "rises", x: "what", y: ["observed", "expected"], title: "Reports against their usual level",
        subtitle: "Last 21 days" }), kpis: [], table: null, display: ds.rows.length ? "chart" : "text" };
    }

    case "developing_stories": {
      const ds: Dataset = { id: "stories", title: "Developing stories",
        fields: [F.text("title", "Story"), F.text("category", "Category"), F.int("reports", "Reports"), { ...F.int("outlets", "Outlets"), additive: false }, F.text("stages", "Stages"), F.text("last", "Latest")],
        rows: (d.rows as Row[]).map((t) => ({ title: t.title, category: t.category, reports: t.reports, outlets: (t.outlets as string[]).length, stages: (t.stages as string[]).join(" → "),
          last: t.last })) };
      return { datasets: [ds], chart: null, kpis: [], table: ds.rows.length ? "stories" : null, display: ds.rows.length ? "table" : "text" };
    }

    case "contacts": {
      const ds: Dataset = { id: "contacts", title: "Officials", fields: [F.text("name", "Name"), F.text("designation", "Designation"), F.text("office", "Office")],
        rows: (d.rows as Row[]).map((c) => pick(c, ["name", "designation", "office"])) };
      return { datasets: [ds], chart: null, kpis: [], table: "contacts", display: ds.rows.length ? "table" : "text" };
    }

    case "environment": {
      const pctUnit = String(d.unit).includes("%");
      const valueField: Field = pctUnit ? F.pct("value", d.label) : F.dec("value", d.label, d.unit);
      const meanField: Field = pctUnit ? F.pct("mean28", "28-day mean") : F.dec("mean28", "28-day mean", d.unit);
      const ds: Dataset = { id: "readings", title: d.label,
        fields: [F.cat("place", "Place"), valueField, meanField, F.text("t", "Reading time"), F.geo("lat", "Latitude"), F.geo("lon", "Longitude")],
        rows: (d.rows as Row[]).map((x) => ({ place: x.place, value: x.value, mean28: x.mean28, t: x.t, lat: x.lat, lon: x.lon })) };
      const w = d.warning as Row | null;
      if (d.metric === "imd_warning_level" && w) {
        // the warning in force, with IMD's own words and the time it was issued
        const wd: Dataset = { id: "warning", title: "IMD warning in force", fields: [F.text("issued", "Issued"), F.int("level", "Level (0 green .. 3 red)"),
          F.text("warning", "Warning")], rows: [{ issued: w.t, level: Number(w.level), warning: w.text ? String(w.text).slice(0, 200) : null }] };
        return { datasets: [wd], chart: null, table: null, display: "kpi",
          kpis: [{ label: "IMD warning level (0 green .. 3 red)", value: Number(w.level), tone: Number(w.level) >= 2 ? "sev" : Number(w.level) === 1 ? "high" : "low" }] };
      }
      if (d.metric === "imd_warning_level" || ds.rows.length <= 1) {
        return { datasets: [ds], chart: null, table: null, display: "kpi",
          kpis: w ? [{ label: "IMD warning level (0 green .. 3 red)", value: Number(w.level), tone: Number(w.level) >= 2 ? "sev" : Number(w.level) === 1 ? "high" : "low" }]
            : ds.rows.map((x) => ({ label: `${d.label}, ${x.place}`, value: Number(x.value), unit: d.unit })) };
      }
      const threshold = d.above != null ? { value: Number(d.above), label: `${d.above}${pctUnit ? "%" : ` ${d.unit}`}` } : d.below != null ? { value: Number(d.below), label: `${d.below}` } : null;
      return { datasets: [ds], chart: spec({ type: "horizontal_bar", dataset: "readings", x: "place", y: ["value"], threshold, topN: 10,
        title: d.above != null ? `${ds.rows.length} places above ${threshold?.label}` : `${d.label} by place`, subtitle: "Latest reading per place" }),
        // with a threshold, the count meeting it is the answer's main figure (the lead-fact check makes the answer state it)
        kpis: threshold ? [{ label: `Places ${d.above != null ? "above" : "below"} ${threshold.label}`, value: ds.rows.length, unit: null }] : [],
        table: null, display: ds.rows.length ? "chart" : "text" };
    }

    case "mandi_prices": {
      if (!d.found) return none;
      const rows = d.rows as Row[];
      const one = rows.length === 1 ? rows[0] : null;
      const datasets: Dataset[] = [];
      let chart: ChartSpec | null = null;
      const kpis: Kpi[] = [];
      if (one) {
        datasets.push({ id: "prices", title: `${one.commodity} by market`, hasPrev: true,
          fields: [F.cat("market", "Market"), F.rs("per_kg", `${one.commodity}, Rs per kg`), F.rs("per_kg_prev", "Previous report")],
          rows: (one.prices as Row[]).map((p) => ({ market: p.market, per_kg: p.per_kg, per_kg_prev: p.prev_per_kg })) });
        if (d.market) {
          const p = (one.prices as Row[])[0];
          kpis.push({ label: `${one.commodity} at ${p.market}, ${p.date}`, value: Number(p.per_kg), prev: p.prev_per_kg == null ? null : Number(p.prev_per_kg), unit: "Rs/kg", format: "rupee" });
        } else {
          // the average is the answer's main figure; the markets are the evidence, cheapest first
          if (one.avg_per_kg != null) kpis.push({ label: `${one.commodity}, average of ${one.markets} Chennai markets`, value: Number(one.avg_per_kg),
            prev: one.avg_prev_per_kg == null ? null : Number(one.avg_prev_per_kg), unit: "Rs/kg", format: "rupee" });
          chart = spec({ type: "horizontal_bar", dataset: "prices", x: "market", y: ["per_kg"], compare: true, highlight: "min",
            title: `${one.commodity} price by Chennai market`, subtitle: `Rs per kg, latest report (${d.latest})` });
        }
      } else {
        datasets.push({ id: "prices", title: "Prices across Chennai markets", hasPrev: true,
          fields: [F.cat("commodity", "Commodity"), F.rs("avg_per_kg", "Average, Rs per kg"), F.rs("avg_per_kg_prev", "Previous report")],
          rows: rows.map((c) => ({ commodity: c.commodity, avg_per_kg: c.avg_per_kg, avg_per_kg_prev: c.avg_prev_per_kg })) });
        chart = spec({ type: "horizontal_bar", dataset: "prices", x: "commodity", y: ["avg_per_kg"], compare: true, title: "Average prices across Chennai markets",
          subtitle: `Rs per kg (${d.latest})` });
      }
      const w = (d.weekly as Row[])[0];
      if (w) datasets.push({ id: "weekly_prices", title: `${w.commodity}, weekly average around Chennai`, fields: [F.time("week", "Week"), F.rs("price", "Rs per kg")],
        rows: (w.series as number[]).map((v, i) => ({ week: w.labels[i], price: Math.round(v) / 100 })) });
      return { datasets, chart, kpis, table: null, display: chart ? "chart" : "kpi" };
    }

    case "source_health": {
      const ds: Dataset = { id: "feeds", title: "Data feeds",
        fields: [F.cat("source", "Feed"), F.text("status", "Status"), F.int("minutes", "Minutes since last success"), F.text("newest", "Newest record")],
        rows: (d.feeds as Row[]).map((f) => ({ source: f.source, status: f.status, minutes: f.minutes_since_success, newest: f.newest })) };
      const ok = (d.feeds as Row[]).filter((f) => f.status === "ok").length;
      return { datasets: [ds], chart: null, table: "feeds", display: "table",
        kpis: [{ label: "Feeds up to date", value: ok, prev: null, tone: ok === (d.feeds as Row[]).length ? "low" : "high" }, { label: "Feeds", value: (d.feeds as Row[]).length }] };
    }

    case "incident_series": {
      const unit = String(d.unit);
      const ds: Dataset = { id: "series", title: "Incidents over time", normal: d.normal ? { lo: d.normal.lo, hi: d.normal.hi, basis: `usual range (10th-90th percentile) of the ${d.normal.n} ${unit}s before` } : null,
        fields: [F.time("bucket", unit === "2 hours" ? "Time" : unit === "week" ? "Week ending" : "Day"), F.int("n", "Incidents reported"), F.int("severe", "Severe"), F.int("open", "Still open")],
        rows: (d.buckets as Row[]).map((b) => ({ bucket: bucketLabel(b.to, unit), n: b.n, severe: b.severe, open: b.open })) };
      return { datasets: [ds], chart: spec({ type: "line", dataset: "series", x: "bucket", y: ["n"], normalBand: !!d.normal, sort: "none", highlight: "max",
        title: "Incidents reported over time", subtitle: `Per ${unit}, ${period}` }), kpis: [], table: null, display: "chart" };
    }

    default:
      return none;
  }
}

/** Datasets from several tools, keeping the first tool's chart and table; dataset ids stay unique. */
/**
 * "Top 3" means three: the dataset the card draws (or tabulates) keeps exactly the n rows asked for, ranked by the
 * chart's measure (lowest first when the question asks for the lowest), with no "Others" bar, and remembers how many
 * rows there were ("showing 3 of 15"). A series over time keeps its buckets.
 */
export function applyTopN(p: Presentation, n: number, question: string): Presentation {
  const id = p.chart && !p.chart.type.startsWith("map") ? p.chart.dataset : p.table ?? p.chart?.dataset;
  const ds = p.datasets.find((d) => d.id === id);
  if (!ds || ds.rows.length <= n) return p;
  const chart = p.chart && p.chart.dataset === ds.id ? p.chart : null;
  if (chart?.x && ds.fields.find((f) => f.key === chart.x)?.kind === "time") return p;
  const low = /\b(lowest|least|fewest|bottom|smallest|minimum)\b|குறைந்த|kammi|kuraiva/i.test(question);
  const y = chart?.y[0];
  const rows = [...ds.rows];
  if (y) rows.sort((a, b) => ((Number(b[y]) || 0) - (Number(a[y]) || 0)) * (low ? -1 : 1));
  const kept: Dataset = { ...ds, rows: rows.slice(0, n), total: ds.total ?? ds.rows.length };
  return {
    ...p, datasets: p.datasets.map((d) => (d.id === ds.id ? kept : d)),
    chart: p.chart && chart ? { ...p.chart, topN: n, sort: y ? (low ? "asc" : "desc") : p.chart.sort, highlight: low ? "min" : p.chart.highlight } : p.chart
  };
}

export function presentAll(results: ToolResult[], question: string, lang: Lang): Presentation {
  const out: Presentation = { datasets: [], chart: null, kpis: [], table: null, display: "text" };
  for (const [k, r] of results.entries()) {
    const p = present(r, question, lang);
    const rename = new Map<string, string>();
    for (const ds of p.datasets) {
      const id = out.datasets.some((x) => x.id === ds.id) ? `${ds.id}_${k}` : ds.id;
      rename.set(ds.id, id);
      out.datasets.push({ ...ds, id });
    }
    if (!out.chart && p.chart) out.chart = { ...p.chart, dataset: rename.get(p.chart.dataset) ?? p.chart.dataset };
    if (!out.table && p.table) out.table = rename.get(p.table) ?? p.table;
    if (out.display === "text" && p.display !== "text") out.display = p.display;
    out.kpis.push(...p.kpis);
  }
  if (out.kpis.length > 6) out.kpis = out.kpis.slice(0, 6);
  // the chart that suits the data and the question, not the same bar every time
  const cds = out.chart ? out.datasets.find((x) => x.id === out.chart!.dataset) : null;
  if (out.chart && cds) {
    const type = bestType(out.chart, cds, question);
    if (type !== out.chart.type) out.chart = checkChart({ ...out.chart, type, sort: type === "line" || type === "area" ? "none" : out.chart.sort }, out.datasets, out.chart).spec ?? out.chart;
  }
  return out;
}
