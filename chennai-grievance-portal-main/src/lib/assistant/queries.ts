/**
 * Read-only queries the assistant needs beyond the console's own data functions. Each
 * one reuses the console's definitions, so its numbers agree with what the console
 * shows: the period window comes from intel.ts (scopeWhere), the zone attention score
 * is the "Hotspot zones" tile's (3 x severe + 1 x high) and the department backlog is the
 * console's (average hours open, departments with 5+ open incidents). The console shows
 * only the top of those rankings; the assistant needs the whole list for a chart.
 *
 * Nothing here writes. Projections (observation_signals.days_to_full, slope_per_day) are
 * never selected: the assistant reports what happened, not forecasts.
 */
import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { PERIODS, exportMeta, scopeWhere } from "@/lib/collector/intel";
import type { AssistantScope } from "@/lib/assistant/scope";

type Row = Record<string, any>;
async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await intelPool.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}
const n = (v: unknown) => Number(v ?? 0);

// ------------------------------------------------------------------ zones --

export interface ZoneRow { zone: number; name: string; score: number; severe: number; high: number; n: number; open: number; complaints: number }

/**
 * Every zone for the scope (the zone filter itself is ignored, as in the console's zone
 * table): incidents reported, open, open citizen complaints, severe and high, and the
 * attention score behind the "Hotspot zones" tile. Ties break by severe, then open.
 */
export async function zoneAttention(s: AssistantScope, now: string): Promise<ZoneRow[]> {
  const w = scopeWhere({ period: s.period, zone: null, dept: s.dept, cat: s.cat, taluk: s.taluk }, now);
  const rows = await q(
    `SELECT z.zone_no AS zone, z.zone_name AS name,
            COALESCE(SUM(CASE i.severity_level WHEN 'Severe' THEN 3 WHEN 'High' THEN 1 ELSE 0 END), 0) AS score,
            COALESCE(SUM(i.severity_level = 'Severe'), 0) AS severe, COALESCE(SUM(i.severity_level = 'High'), 0) AS high,
            COUNT(i.incident_id) AS n, COALESCE(SUM(i.is_open), 0) AS open,
            COALESCE(SUM(CASE WHEN i.is_open = 1 THEN i.citizen_complaints ELSE 0 END), 0) AS complaints
     FROM (SELECT DISTINCT zone_no, zone_name FROM ref_wards) z
     LEFT JOIN incidents i ON i.zone_no = z.zone_no AND ${w.sql}
     GROUP BY z.zone_no, z.zone_name ORDER BY score DESC, severe DESC, open DESC, z.zone_no`,
    w.params
  );
  return rows.map((r) => ({ zone: n(r.zone), name: String(r.name), score: n(r.score), severe: n(r.severe), high: n(r.high),
    n: n(r.n), open: n(r.open), complaints: n(r.complaints) }));
}

// ------------------------------------------------------------ departments --

export interface BacklogRow { code: string; name: string; hours: number; n: number; overdue: number }

/** Departments by the average age of their open incidents (5+ open), as the console's backlog card; not period-bound. */
export async function deptBacklog(zone: number | null): Promise<BacklogRow[]> {
  const rows = await q(
    `SELECT i.lead_dept AS code, dp.name, AVG(i.hours_open) AS h, COUNT(*) AS n, SUM(i.sla_breached = 1) AS overdue
     FROM incidents i LEFT JOIN ref_departments dp ON dp.code = i.lead_dept
     WHERE i.is_open = 1 ${zone ? "AND i.zone_no = ?" : ""} GROUP BY i.lead_dept, dp.name HAVING n >= 5 ORDER BY h DESC`,
    zone ? [zone] : []
  );
  return rows.map((r) => ({ code: String(r.code), name: String(r.name ?? r.code), hours: n(r.h), n: n(r.n), overdue: n(r.overdue) }));
}

// ------------------------------------------------------------- test data --

/** How many incidents in the scope come from synthetic (test) sources. */
export async function syntheticShare(s: AssistantScope, now: string): Promise<{ n: number; syn: number }> {
  const w = scopeWhere(s, now);
  const [r] = await q(`SELECT COUNT(*) AS n, COALESCE(SUM(i.is_synthetic_any), 0) AS syn FROM incidents i WHERE ${w.sql}`, w.params);
  return { n: n(r?.n), syn: n(r?.syn) };
}

/**
 * How many incidents are in the news with no department record, over the Briefing page's
 * window (the period, or 7 days if longer); its list shows only the top 40.
 */
export async function newsGapTotal(s: AssistantScope, now: string): Promise<number> {
  const w = scopeWhere({ ...s, period: s.period === "daily" ? "weekly" : s.period }, now);
  const [r] = await q(`SELECT COUNT(*) AS n FROM incidents i WHERE ${w.sql} AND i.media_only = 1 AND i.status_std <> 'Lapsed'`, w.params);
  return n(r?.n);
}

/** Whether one incident includes synthetic or scenario-overlay records. */
export async function incidentFlags(id: string): Promise<{ synthetic: boolean; overlay: boolean }> {
  const [r] = await q(`SELECT is_synthetic_any, is_overlay_any FROM incidents WHERE incident_id = ?`, [id]);
  return { synthetic: Number(r?.is_synthetic_any) === 1, overlay: Number(r?.is_overlay_any) === 1 };
}

// ----------------------------------------------------------------- places --

export interface PlaceCount { key: string; n: number; open: number; severe: number; high: number; lat: number | null; lon: number | null; zone_name: string | null }
export interface PlacePoint { id: string; title: string | null; type: string | null; sev: string | null; open: boolean; place: string | null; lat: number; lon: number; priority: number | null }
export interface PlaceBreakdown {
  total: { n: number; open: number; severe: number; high: number; syn: number };
  localities: PlaceCount[];
  wards: (PlaceCount & { ward: number })[];
  types: { code: string; label: string; n: number; open: number; severe: number }[];
  points: PlacePoint[];
}

/**
 * The locality an incident's place text names. Place texts run from a bare locality ("Velachery")
 * through a site in brackets ("Velachery (Velachery Lake)") to a street address ending in its
 * locality ("Sasi Nagar East Street, Sasi Nagar, Velachery"): the part before a bracket, then the
 * last comma-separated part.
 */
const LOCALITY = `NULLIF(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(i.place_text, ' (', 1), ',', -1)), '')`;

/**
 * Where the scope's incidents happened: by locality, by ward (with the ward's centroid), by incident
 * type, and up to 400 located incidents for the map, highest priority first. `place` narrows to
 * incidents whose place text names it (a locality inside the scope's zone); then localities are
 * grouped by the full place text, so the answer shows the streets and sites within it.
 */
export async function placeBreakdown(s: AssistantScope, now: string, place: string | null): Promise<PlaceBreakdown> {
  const w = scopeWhere(s, now);
  const like = place ? ` AND i.place_text LIKE ?` : "";
  const params = place ? [...w.params, `%${place.replace(/[%_\\]/g, (c) => `\\${c}`)}%`] : w.params;
  const where = `${w.sql}${like}`;
  const key = place ? `NULLIF(TRIM(SUBSTRING(i.place_text, 1, 80)), '')` : LOCALITY;
  const counts = `COUNT(*) AS n, COALESCE(SUM(i.is_open), 0) AS open, COALESCE(SUM(i.severity_level = 'Severe'), 0) AS severe,
    COALESCE(SUM(i.severity_level = 'High'), 0) AS high`;
  const [total, localities, wards, types, points, wardPlaces] = await Promise.all([
    q(`SELECT ${counts}, COALESCE(SUM(i.is_synthetic_any), 0) AS syn FROM incidents i WHERE ${where}`, params),
    q(`SELECT ${key} AS k, ${counts}, AVG(i.lat) AS lat, AVG(i.lon) AS lon, MIN(i.zone_name) AS zone_name
       FROM incidents i WHERE ${where} GROUP BY k HAVING k IS NOT NULL ORDER BY n DESC, severe DESC, k LIMIT 25`, params),
    q(`SELECT i.ward_no AS ward, ${counts}, MIN(rw.centroid_lat) AS lat, MIN(rw.centroid_lon) AS lon, MIN(i.zone_name) AS zone_name
       FROM incidents i LEFT JOIN ref_wards rw ON rw.ward_no = i.ward_no
       WHERE ${where} AND i.ward_no IS NOT NULL GROUP BY i.ward_no ORDER BY n DESC, severe DESC, i.ward_no LIMIT 25`, params),
    q(`SELECT i.category_code AS code, MIN(i.category_label) AS label, COUNT(*) AS n, COALESCE(SUM(i.is_open), 0) AS open,
         COALESCE(SUM(i.severity_level = 'Severe'), 0) AS severe
       FROM incidents i WHERE ${where} GROUP BY i.category_code ORDER BY n DESC LIMIT 12`, params),
    q(`SELECT i.incident_id AS id, i.title, i.category_label AS type, i.severity_level AS sev, i.is_open AS open, i.place_text AS place, i.lat, i.lon,
         i.priority_score AS priority
       FROM incidents i WHERE ${where} AND i.lat IS NOT NULL AND i.lon IS NOT NULL
       ORDER BY i.priority_score DESC, i.first_reported_at DESC LIMIT 400`, params),
    // wards have numbers, not names: each is labelled by its busiest locality
    q(`SELECT i.ward_no AS ward, ${LOCALITY} AS k, COUNT(*) AS n FROM incidents i WHERE ${where} AND i.ward_no IS NOT NULL
       GROUP BY i.ward_no, k HAVING k IS NOT NULL ORDER BY n DESC LIMIT 2000`, params)
  ]);
  const wardName = new Map<number, string>();
  for (const r of wardPlaces) if (!wardName.has(n(r.ward))) wardName.set(n(r.ward), String(r.k));
  const t = total[0] ?? {};
  const num = (v: unknown) => (v == null ? null : Number(v));
  const count = (r: Row): Omit<PlaceCount, "key"> => ({ n: n(r.n), open: n(r.open), severe: n(r.severe), high: n(r.high), lat: num(r.lat), lon: num(r.lon),
    zone_name: r.zone_name ?? null });
  return {
    total: { n: n(t.n), open: n(t.open), severe: n(t.severe), high: n(t.high), syn: n(t.syn) },
    localities: localities.map((r) => ({ key: String(r.k), ...count(r) })),
    wards: wards.map((r) => ({ key: wardName.has(n(r.ward)) ? `Ward ${r.ward} · ${wardName.get(n(r.ward))}` : `Ward ${r.ward}`, ward: n(r.ward), ...count(r) })),
    types: types.map((r) => ({ code: String(r.code), label: String(r.label ?? r.code), n: n(r.n), open: n(r.open), severe: n(r.severe) })),
    points: points.map((r) => ({ id: String(r.id), title: r.title ?? null, type: r.type ?? null, sev: r.sev ?? null, open: Number(r.open) === 1,
      place: r.place ?? null, lat: Number(r.lat), lon: Number(r.lon), priority: num(r.priority) }))
  };
}

export interface PartRow { code: string; label: string; n: number; prev: number; open: number; severe: number; high: number; complaints: number; syn: number;
  zones: { name: string; n: number }[]; places: { name: string; n: number }[] }

/**
 * Per incident category, for a summary of several subjects: reported in the period and the one before, open, severe,
 * high, citizen complaints, test-data share, and where it happened (zones and localities, busiest first).
 */
export async function categoryFigures(s: AssistantScope, now: string, codes: string[]): Promise<PartRow[]> {
  if (!codes.length) return [];
  const base = { period: s.period, zone: s.zone, dept: s.dept, cat: null, taluk: s.taluk };
  const w = scopeWhere(base, now), wp = scopeWhere({ ...base, offset: 1 } as typeof base, now);
  const inCodes = `i.category_code IN (${codes.map(() => "?").join(",")})`;
  const [cur, prev, zones, places] = await Promise.all([
    q(`SELECT i.category_code AS code, MIN(i.category_label) AS label, COUNT(*) AS n, COALESCE(SUM(i.is_open), 0) AS open,
         COALESCE(SUM(i.severity_level = 'Severe'), 0) AS severe, COALESCE(SUM(i.severity_level = 'High'), 0) AS high,
         COALESCE(SUM(i.citizen_complaints), 0) AS complaints, COALESCE(SUM(i.is_synthetic_any), 0) AS syn
       FROM incidents i WHERE ${w.sql} AND ${inCodes} GROUP BY i.category_code`, [...w.params, ...codes]),
    q(`SELECT i.category_code AS code, COUNT(*) AS n FROM incidents i WHERE ${wp.sql} AND ${inCodes} GROUP BY i.category_code`, [...wp.params, ...codes]),
    q(`SELECT i.category_code AS code, i.zone_name AS name, COUNT(*) AS n FROM incidents i WHERE ${w.sql} AND ${inCodes} AND i.zone_name IS NOT NULL
       GROUP BY i.category_code, i.zone_name ORDER BY n DESC`, [...w.params, ...codes]),
    q(`SELECT i.category_code AS code, ${LOCALITY} AS name, COUNT(*) AS n FROM incidents i WHERE ${w.sql} AND ${inCodes}
       GROUP BY i.category_code, name HAVING name IS NOT NULL ORDER BY n DESC LIMIT 400`, [...w.params, ...codes])
  ]);
  const prevBy = new Map(prev.map((r) => [String(r.code), n(r.n)]));
  return codes.map((code) => {
    const r = cur.find((x) => String(x.code) === code);
    return {
      code, label: String(r?.label ?? code), n: n(r?.n), prev: prevBy.get(code) ?? 0, open: n(r?.open), severe: n(r?.severe), high: n(r?.high),
      complaints: n(r?.complaints), syn: n(r?.syn),
      zones: zones.filter((z) => String(z.code) === code).map((z) => ({ name: String(z.name), n: n(z.n) })),
      places: places.filter((p) => String(p.code) === code).map((p) => ({ name: String(p.name), n: n(p.n) }))
    };
  });
}

/** Short rows for a set of incidents (the other close matches of a story), in the order given. */
export async function incidentsByIds(ids: string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const rows = await q(
    `SELECT incident_id AS id, title, category_label AS type, zone_name, place_text AS place, severity_level AS sev, status_std AS status,
            DATE_FORMAT(first_reported_at, '%Y-%m-%d %H:%i') AS t, is_synthetic_any AS syn
     FROM incidents WHERE incident_id IN (${ids.map(() => "?").join(",")})`, ids);
  const by = new Map(rows.map((r) => [String(r.id), r]));
  return ids.map((id) => by.get(id)).filter((r): r is Row => !!r);
}

// ------------------------------------------------------------------ feeds --

export interface FeedRow { source: string; kind: string | null; status: string; minutes_since_success: number | null; rows: number; newest: string | null }

/** The pipeline's feeds as the console's feed light reads them, and when the store was last exported. */
export async function feeds(): Promise<{ rows: FeedRow[]; exportedAt: string | null }> {
  const [rows, meta] = await Promise.all([
    q(`SELECT source, kind, status, minutes_since_success, \`rows\` AS row_count, DATE_FORMAT(newest_record_at, '%Y-%m-%d %H:%i:%s') AS newest
       FROM source_health ORDER BY FIELD(source, 'grievance', 'police', 'pwd', 'hospital', 'news', 'imd', 'cpcb', 'cfm')`),
    exportMeta()
  ]);
  return {
    rows: rows.map((r) => ({ source: String(r.source), kind: r.kind ?? null, status: String(r.status),
      minutes_since_success: r.minutes_since_success == null ? null : n(r.minutes_since_success), rows: n(r.row_count), newest: r.newest ?? null })),
    exportedAt: meta.exported_at ?? null
  };
}

// ----------------------------------------------------------------- series --

export interface SeriesBucket { from: string; to: string; n: number; severe: number; open: number }

const wall = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 19).replace("T", " ");

/**
 * Incidents reported in the scope, in the console's buckets for the period (2-hour buckets
 * for a day, daily for a week or month, weekly for a quarter), each a full window ending at
 * the as-of time, so the first and last buckets are never partial.
 */
export async function incidentSeries(s: AssistantScope, now: string): Promise<SeriesBucket[]> {
  const p = PERIODS[s.period];
  const w = scopeWhere(s, now);
  const secs = (p.hours * 3600) / p.buckets;
  const rows = await q(
    `SELECT FLOOR(TIMESTAMPDIFF(SECOND, ? - INTERVAL ? HOUR, i.first_reported_at) / ?) AS b, COUNT(*) AS n,
            SUM(i.severity_level = 'Severe') AS severe, SUM(i.is_open) AS open
     FROM incidents i WHERE ${w.sql} GROUP BY b`,
    [now, p.hours, secs, ...w.params]
  );
  const end = new Date(now.replace(" ", "T") + "+05:30").getTime();
  const start = end - p.hours * 3600_000;
  const out: SeriesBucket[] = Array.from({ length: p.buckets }, (_, k) => ({
    from: wall(new Date(start + k * secs * 1000)), to: wall(new Date(start + (k + 1) * secs * 1000)), n: 0, severe: 0, open: 0
  }));
  for (const r of rows) {
    const b = Math.min(p.buckets - 1, Math.max(0, n(r.b)));
    out[b].n += n(r.n);
    out[b].severe += n(r.severe);
    out[b].open += n(r.open);
  }
  return out;
}

/**
 * The usual range of the series, for the "normal band": the 10th to 90th percentile of the
 * same buckets over the two windows before the period. It describes history and forecasts
 * nothing. Buckets before the store's first record are left out; the 2-hour buckets of a
 * single day have no band (night and day differ too much for one range).
 */
export async function seriesNormal(s: AssistantScope, now: string): Promise<{ lo: number; hi: number; mean: number; n: number; from: string; to: string } | null> {
  const p = PERIODS[s.period];
  if (s.period === "daily") return null;
  const secs = (p.hours * 3600) / p.buckets;
  const [first] = await q(`SELECT DATE_FORMAT(MIN(first_reported_at), '%Y-%m-%d %H:%i:%s') AS t FROM incidents`);
  const firstMs = first?.t ? Date.parse(String(first.t).replace(" ", "T") + "+05:30") : 0;
  const end = Date.parse(now.replace(" ", "T") + "+05:30");
  const values: number[] = [];
  for (const offset of [1, 2]) {
    const w = scopeWhere({ ...s, offset }, now);
    const rows = await q(
      `SELECT FLOOR(TIMESTAMPDIFF(SECOND, ? - INTERVAL ? HOUR, i.first_reported_at) / ?) AS b, COUNT(*) AS n FROM incidents i WHERE ${w.sql} GROUP BY b`,
      [now, p.hours * (offset + 1), secs, ...w.params]
    );
    const counts = Array(p.buckets).fill(0);
    for (const r of rows) counts[Math.min(p.buckets - 1, Math.max(0, n(r.b)))] += n(r.n);
    const start = end - p.hours * 3600_000 * (offset + 1);
    counts.forEach((c, k) => { if (start + k * secs * 1000 >= firstMs) values.push(c); });
  }
  if (values.length < 5) return null;
  values.sort((a, b) => a - b);
  const pick = (x: number) => values[Math.round((values.length - 1) * x)];
  return {
    lo: pick(0.1), hi: pick(0.9), mean: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10, n: values.length,
    from: wall(new Date(end - p.hours * 3600_000 * 3)), to: wall(new Date(end - p.hours * 3600_000))
  };
}

// ------------------------------------------------------------ environment --

/** Readings the assistant may report, with their unit and whether the source is real or test data. */
export const ENV_METRICS = {
  aqi: { label: "Air quality index", unit: "AQI", source: "cpcb", test: false },
  rainfall_24h_mm: { label: "Rainfall in 24 hours", unit: "mm", source: "imd", test: false },
  temp_max_c: { label: "Maximum temperature", unit: "°C", source: "imd", test: false },
  temp_min_c: { label: "Minimum temperature", unit: "°C", source: "imd", test: false },
  temp_departure_c: { label: "Temperature departure from normal", unit: "°C", source: "imd", test: false },
  humidity_pct: { label: "Relative humidity", unit: "%", source: "imd", test: false },
  imd_warning_level: { label: "IMD warning level (0 green, 1 yellow, 2 orange, 3 red)", unit: "level", source: "imd", test: false },
  reservoir_inflow_cusec: { label: "Reservoir inflow", unit: "cusec", source: "cfm", test: false },
  lake_pct_full: { label: "Lake storage", unit: "% full", source: "pwd", test: true },
  lake_storage_mcft: { label: "Lake storage", unit: "mcft", source: "pwd", test: true },
  lake_outflow_cusec: { label: "Lake outflow", unit: "cusec", source: "pwd", test: true },
  bed_occupancy_pct: { label: "Hospital bed occupancy", unit: "%", source: "hospital", test: true },
  occupied_beds: { label: "Occupied hospital beds", unit: "beds", source: "hospital", test: true },
  total_beds: { label: "Hospital beds", unit: "beds", source: "hospital", test: true },
  emergency_cases: { label: "Emergency cases", unit: "cases", source: "hospital", test: true },
  opd_count: { label: "Outpatients", unit: "patients", source: "hospital", test: true },
  disease_cases: { label: "Disease cases", unit: "cases", source: "hospital", test: true },
  health_alert_level: { label: "Hospital alert level (0 normal .. 3 critical)", unit: "level", source: "hospital", test: true },
  medicine_status: { label: "Medicine availability (0 critical, 1 limited, 2 available)", unit: "level", source: "hospital", test: true },
  ambulance_available: { label: "Ambulance available (1 yes, 0 no)", unit: "flag", source: "hospital", test: true },
  vaccination_pct: { label: "Vaccination coverage", unit: "%", source: "hospital", test: true },
  doctors_on_roll: { label: "Doctors on roll", unit: "staff", source: "hospital", test: true },
  nurses_on_roll: { label: "Nurses on roll", unit: "staff", source: "hospital", test: true }
} as const;
export type EnvMetric = keyof typeof ENV_METRICS;

export interface SignalRow {
  place_id: string; place: string; taluk: string | null; taluk_code: string | null; lat: number | null; lon: number | null;
  t: string; value: number; unit: string; mean28: number | null; ewma7: number | null; zscore: number | null; points: number;
  anomaly: boolean; detail: string | null; source: string
}

/**
 * Latest reading per place for one metric, with its descriptive references (28-day mean,
 * 7-day EWMA, z-score). Readings after the as-of time (IMD warnings issued for coming
 * days) are left out: the assistant does not forecast.
 */
export async function envSignals(metric: EnvMetric, now: string): Promise<SignalRow[]> {
  const rows = await q(
    `SELECT s.place_id, s.place_name, s.taluk_code, t.name AS taluk, s.lat, s.lon, DATE_FORMAT(s.observed_at, '%Y-%m-%d %H:%i:%s') AS t,
            s.value, s.unit, s.mean28, s.ewma7, s.zscore, s.n_points, s.anomaly, s.detail, s.source
     FROM observation_signals s LEFT JOIN ref_taluks t ON t.taluk_code = s.taluk_code
     WHERE s.metric = ? AND s.observed_at <= ? ORDER BY s.value DESC, s.place_name`,
    [metric, now]
  );
  const num = (v: unknown) => (v == null ? null : Number(v));
  return rows.map((r) => ({
    place_id: String(r.place_id), place: String(r.place_name ?? r.place_id), taluk: r.taluk ?? null, taluk_code: r.taluk_code ?? null,
    lat: num(r.lat), lon: num(r.lon), t: String(r.t), value: Number(r.value), unit: String(r.unit ?? ENV_METRICS[metric].unit),
    mean28: num(r.mean28), ewma7: num(r.ewma7), zscore: num(r.zscore), points: n(r.n_points), anomaly: Number(r.anomaly) === 1,
    detail: r.detail ?? null, source: String(r.source)
  }));
}

/** IMD warning text for the as-of day (the warning in force), from the observations the signal is built on. */
export async function warningToday(now: string): Promise<{ t: string; level: number; text: string | null } | null> {
  const [r] = await q(
    `SELECT DATE_FORMAT(observed_at, '%Y-%m-%d %H:%i:%s') AS t, value, detail FROM observations
     WHERE metric = 'imd_warning_level' AND observed_at <= ? ORDER BY observed_at DESC LIMIT 1`,
    [now]
  );
  return r ? { t: String(r.t), level: Number(r.value), text: r.detail ?? null } : null;
}

// ----------------------------------------------------------------- sources --

/** Sources the Collector added or the console runs itself, without URLs, logins or secrets. */
export async function addedSources(): Promise<Row[]> {
  return q(
    `SELECT source_id AS id, name, kind, pipeline_key, enabled, status, refresh_minutes, items_total,
            DATE_FORMAT(last_ok_at, '%Y-%m-%d %H:%i:%s') AS last_ok_at, DATE_FORMAT(last_run_at, '%Y-%m-%d %H:%i:%s') AS last_run_at
     FROM ${ops("sources")} ORDER BY FIELD(kind, 'pipeline', 'agmarknet', 'ocr', 'rss', 'html', 'json'), source_id`
  ).catch(() => []);
}
