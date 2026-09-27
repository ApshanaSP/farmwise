import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";

/** Dashboard periods and the KPI period each one reads. */
export const PERIODS = {
  today: { kpi: "daily", label: "Today", days: 1 },
  week: { kpi: "weekly", label: "7 days", days: 7 },
  month: { kpi: "monthly", label: "30 days", days: 30 },
  quarter: { kpi: "quarterly", label: "Quarter", days: 90 }
} as const;
export type PeriodKey = keyof typeof PERIODS;

export function parsePeriod(value: string | string[] | undefined): PeriodKey {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v in PERIODS ? (v as PeriodKey) : "week";
}

type Row = Record<string, any>;

async function rows<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await intelPool.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}

export interface Decision {
  decision_id: number;
  incident_id: string;
  decision: "verify" | "escalate" | "reject" | "resolve" | "reopen" | "note";
  escalate_to: string | null;
  note: string | null;
  decided_by: string;
  decided_at: string;
}

/** Latest Collector decision per incident (the pipeline may not have applied it yet). */
export async function latestDecisions(incidentIds: string[]): Promise<Record<string, Decision>> {
  if (incidentIds.length === 0) return {};
  const r = await rows<Decision>(
    `SELECT decision_id, incident_id, decision, escalate_to, note, decided_by, decided_at FROM (
       SELECT d.*, ROW_NUMBER() OVER (PARTITION BY incident_id ORDER BY decision_id DESC) AS rn
       FROM ${ops("collector_decisions")} d
       WHERE incident_id IN (?) AND decision <> 'note'
     ) x WHERE rn = 1`,
    [incidentIds]
  );
  return Object.fromEntries(r.map((d) => [d.incident_id, d]));
}

const INCIDENT_LIST_COLUMNS = `incident_id, title, category_label, family, lead_dept, severity_level, severity_score,
  priority_score, priority_reasons, attention_reason, awaiting_collector, attention_flag, status_std, is_open, verified,
  sources, source_count, citizen_complaints, outlet_count, media_only, zone_no, zone_name, ward_no, place_text,
  lat, lon, first_reported_at, sla_due_at, sla_breached, hours_open, needs_coordination, is_overlay_any`;

export async function getOverview(period: PeriodKey) {
  const p = PERIODS[period];

  const [meta, asOfRow, kpis, queue, alerts, wards, pins, gaps, health, briefing, env] = await Promise.all([
    rows(`SELECT k, v FROM _export_meta`),
    rows(`SELECT JSON_UNQUOTE(value) AS v FROM metrics WHERE metric = 'as_of'`),
    rows(`SELECT * FROM kpis WHERE period = ? AND zone_no IS NULL AND \`offset\` IN (0, 1) ORDER BY \`offset\``, [p.kpi]),
    rows(
      `SELECT ${INCIDENT_LIST_COLUMNS} FROM incidents
       WHERE is_open = 1 AND (awaiting_collector = 1 OR attention_flag = 1)
       ORDER BY attention_flag DESC, priority_score DESC LIMIT 40`
    ),
    rows(
      `SELECT alert_id, type, severity, title, message, explanation, place, zone_no, date, category_code, incident_ids
       FROM alerts WHERE status = 'new'
       ORDER BY FIELD(severity, 'Severe', 'High', 'Medium', 'Low'), date DESC LIMIT 12`
    ),
    rows(
      `SELECT ward_no, zone_no, zone_name, open_incidents, incidents_30d, open_past_deadline, flood_reports,
              low_lying_index, hot_ward, geometry
       FROM ref_wards`
    ),
    rows(
      `SELECT incident_id, title, severity_level, priority_score, lat, lon, zone_name, ward_no, status_std, category_label
       FROM incidents WHERE is_open = 1 AND lat IS NOT NULL AND severity_level IN ('Severe', 'High')
       ORDER BY priority_score DESC LIMIT 250`
    ),
    rows(
      `SELECT incident_id, title, category_code, lead_dept, zone_name, ward_no, outlet_count, first_reported_at,
              severity_level, priority_score, gap_strength, suggested_action
       FROM gaps ORDER BY priority_score DESC LIMIT 8`
    ),
    rows(
      `SELECT source, kind, status, minutes_since_success, newest_record_at, \`rows\` AS row_count, detail
       FROM source_health ORDER BY FIELD(status, 'down', 'stale', 'degraded', 'ok'), source`
    ),
    rows(`SELECT briefing_id, period, as_of, markdown, method FROM briefings WHERE period = ? LIMIT 1`, [p.kpi]),
    rows(
      `SELECT metric, place_name, observed_at, value, unit, zscore, anomaly, detail, days_to_full
       FROM observation_signals
       WHERE metric IN ('rainfall_24h_mm', 'aqi', 'lake_pct_full', 'bed_occupancy_pct', 'imd_warning_level', 'temp_max_c')`
    )
  ]);

  // The pipeline's as-of time (newest record across sources), "2026-09-27 01:50:00+05:30" -> IST wall-clock.
  const asOf = asOfRow[0]?.v ? String(asOfRow[0].v).slice(0, 19).replace("T", " ") : null;
  const exportedAt = (meta.find((m) => m.k === "exported_at") || {}).v ?? null;

  // Trend: the last N days (at least 30) up to the newest day in the store, split by source.
  const trendDays = Math.max(30, p.days);
  const [trend, calendar] = await Promise.all([
    rows(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, source, SUM(count) AS n FROM daily_counts
       WHERE date > (SELECT MAX(date) FROM daily_counts) - INTERVAL ? DAY
       GROUP BY date, source ORDER BY date`,
      [trendDays]
    ),
    rows(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, rain_event, festival, protest FROM world_calendar
       WHERE date > (SELECT MAX(date) FROM daily_counts) - INTERVAL ? DAY`,
      [trendDays]
    )
  ]);

  const decisions = await latestDecisions(queue.map((q) => q.incident_id));

  return {
    period,
    periodLabel: p.label,
    asOf,
    exportedAt,
    kpi: { current: kpis.find((k) => k.offset === 0) ?? null, previous: kpis.find((k) => k.offset === 1) ?? null },
    queue: queue.map((q) => ({ ...q, decision: decisions[q.incident_id] ?? null }) as Row & { decision: Decision | null }),
    alerts,
    wards: wards.map((w) => ({ ...w, geometry: typeof w.geometry === "string" ? JSON.parse(w.geometry) : w.geometry }) as Row),
    pins,
    gaps,
    health,
    briefing: briefing[0] ?? null,
    environment: env,
    trend,
    calendar
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;

export async function getIncident(id: string) {
  const [incident] = await rows(`SELECT * FROM incidents WHERE incident_id = ? LIMIT 1`, [id]);
  if (!incident) return null;

  const [members, timeline, actions, documents, decisions, departments] = await Promise.all([
    rows(
      `SELECT m.event_id, m.source, m.source_record_id, m.channel, m.reported_at, m.link_prob, m.link_method,
              m.severity_level, m.status_std, m.deep_link, m.title, m.is_overlay, m.role,
              e.place_text, e.ward_no, e.category_src, e.text
       FROM incident_members m LEFT JOIN events e ON e.event_id = m.event_id
       WHERE m.incident_id = ? ORDER BY m.role = 'first_report' DESC, m.reported_at`,
      [id]
    ),
    rows(
      `SELECT at, step, status_std, actor, note, source, event_id FROM incident_timeline
       WHERE incident_id = ? ORDER BY at, step`,
      [id]
    ),
    rows(
      `SELECT action_id, dept_code, office_id, owner, text, status, origin, assigned_at, due_at, completed_at
       FROM actions WHERE incident_id = ? ORDER BY origin, assigned_at`,
      [id]
    ),
    rows(
      `SELECT doc_id, title, publisher, url, published_at, lang FROM documents
       WHERE linked_incident_id = ? ORDER BY published_at LIMIT 20`,
      [id]
    ),
    rows<Decision>(
      `SELECT decision_id, incident_id, decision, escalate_to, note, decided_by, decided_at
       FROM ${ops("collector_decisions")} WHERE incident_id = ? ORDER BY decision_id DESC`,
      [id]
    ),
    rows(`SELECT code, name FROM ref_departments WHERE action_owner = 1 ORDER BY name`)
  ]);

  return { incident, members, timeline, actions, documents, decisions, departments };
}

export type IncidentDetail = NonNullable<Awaited<ReturnType<typeof getIncident>>>;
