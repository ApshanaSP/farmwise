/**
 * The data catalog for questions no tool answers: which tables and columns the query
 * planner may use, what they mean, their units, how joins go, how to tell test data, and
 * which rows are out of bounds (anything after the data's as-of time).
 *
 * The column list comes from information_schema (read at run time, cached per pipeline
 * export; schema.snapshot.json from scripts/generate-assistant-catalog.js is the fallback
 * and the test fixture). The descriptions and rules below are curated. Access is default
 * deny: a table or column is usable only when it is described here, so a column the
 * pipeline adds later stays out until someone describes it. Never allowed: predictions
 * (the forecasts table, observation_signals.days_to_full and slope_per_day), citizens'
 * identifiers (events.reporter_hash), free text (complaint text, article bodies), and
 * officials' phone numbers and emails.
 */
import { RowDataPacket } from "mysql2";
import intelPool, { INTEL_DB, OPS_DB } from "@/lib/collector/db";
import { exportMeta } from "@/lib/collector/intel";
import snapshotFile from "@/lib/assistant/schema.snapshot.json";

export type ColumnRole = "id" | "dim" | "measure" | "time" | "flag" | "label" | "geo";
interface ColOpt {
  unit?: string;
  /** declared join key: "table.column" */
  join?: string;
  /** allowed values, for filters */
  values?: readonly string[];
  /** text from outside the store's rules (headlines): shown to the model only inside <untrusted_data> */
  untrusted?: boolean;
  /** derived from incidents, so it counts test data even in a reference table */
  test?: boolean;
}
type Col = [ColumnRole, string, ColOpt?];

interface TableSpec {
  db: "intel" | "ops";
  d: string;
  grain: string;
  /** default time field for windows (anchored to the as-of time) */
  time?: string;
  /** rows beyond this condition are never read; ":asOf" is the data's as-of time. Default: `${time} <= :asOf` */
  cap?: string | null;
  /** SQL over the table, true for rows from test (synthetic) sources; "0" = real data, "1" = always includes test data */
  test: string;
  note?: string;
  cols: Record<string, Col>;
}

const SEV = ["Severe", "High", "Medium", "Low"] as const;
const STATUS = ["Open", "Under review", "Assigned", "In progress", "Awaiting verification", "Resolved", "Rejected", "Lapsed"] as const;
const J = {
  cat: { join: "ref_categories.category_code" }, dept: { join: "ref_departments.code" }, zone: { join: "ref_zones.zone_no" },
  ward: { join: "ref_wards.ward_no" }, taluk: { join: "ref_taluks.taluk_code" }, inc: { join: "incidents.incident_id" },
  office: { join: "ref_offices.office_id" }
} as const;

export const POLICY: Record<string, TableSpec> = {
  incidents: {
    db: "intel", d: "Real-world incidents: each is a cross-source roll-up of the complaints, police, PWD, hospital, IMD and news records about one event. The console's counts come from here.",
    grain: "one row per incident", time: "first_reported_at", test: "is_synthetic_any = 1",
    cols: {
      incident_id: ["id", "incident ID (INC-...)"], title: ["label", "short title: category and place, or a news headline", { untrusted: true }],
      category_code: ["dim", "category code", J.cat], category_label: ["label", "category name"], family: ["dim", "category family"],
      lead_dept: ["dim", "lead department code", J.dept], needs_coordination: ["flag", "needs several departments"],
      first_reported_at: ["time", "when first reported (IST)"], last_update_at: ["time", "last update (IST)"], closed_at: ["time", "when closed"],
      verified_at: ["time", "when verified"], ward_no: ["dim", "GCC ward 1-200", J.ward], zone_no: ["dim", "GCC zone 1-15", J.zone],
      zone_name: ["label", "zone name"], taluk_code: ["dim", "revenue taluk code (TLK-...)", J.taluk], lat: ["geo", "latitude"], lon: ["geo", "longitude"],
      place_text: ["label", "place of the incident"], member_count: ["measure", "records merged into the incident", { unit: "records" }],
      sources: ["dim", "sources, pipe-separated (grievance|police|pwd|hospital|imd|news)"], source_count: ["measure", "number of distinct sources"],
      citizen_complaints: ["measure", "citizen complaints linked", { unit: "complaints" }], police_reports: ["measure", "police reports linked"],
      outlet_count: ["measure", "news outlets covering it"], has_official_record: ["flag", "a department record exists"],
      media_only: ["flag", "seen only in the news"], is_synthetic_any: ["flag", "includes test (synthetic) records"],
      is_overlay_any: ["flag", "includes scenario-overlay records"], status_std: ["dim", "status", { values: STATUS }],
      verified: ["flag", "verified"], is_open: ["flag", "still open"], severity_score: ["measure", "severity score 0-100"],
      severity_level: ["dim", "severity", { values: SEV }], dead: ["measure", "people dead", { unit: "persons" }],
      injured: ["measure", "people injured", { unit: "persons" }], persons_affected: ["measure", "people affected", { unit: "persons" }],
      weather_related: ["flag", "weather related"], confidence: ["measure", "confidence of the match and place, 0-1"],
      needs_review: ["flag", "sent to the review queue"], sla_hours: ["measure", "resolution deadline length", { unit: "hours" }],
      sla_due_at: ["time", "resolution deadline"], hours_open: ["measure", "hours open (to the as-of time or closure)", { unit: "hours" }],
      hours_to_first_action: ["measure", "hours to the first action", { unit: "hours" }], sla_breached: ["flag", "past its deadline"],
      growth_24h: ["measure", "new reports in the last 24 hours"], recurrence_90d: ["measure", "similar incidents here in 90 days"],
      rain_coupled: ["flag", "rises with rain"], priority_score: ["measure", "priority score (higher = more urgent)"],
      awaiting_collector: ["flag", "awaiting the Collector's verification"], attention_flag: ["flag", "flagged for the Collector's attention"],
      hotspot_id: ["dim", "hotspot it belongs to", { join: "hotspots.hotspot_id" }], action_total: ["measure", "actions planned"],
      action_done: ["measure", "actions done"], next_action_due: ["time", "next action due"]
    }
  },
  events: {
    db: "intel", d: "Source records before merging: citizen complaints, police reports, PWD incidents, hospital alert episodes, IMD warnings and news incidents.",
    grain: "one row per source record", time: "reported_at", test: "is_synthetic = 1",
    cols: {
      event_id: ["id", "record ID"], source: ["dim", "source", { values: ["grievance", "police", "pwd", "hospital", "imd", "news"] }],
      is_synthetic: ["flag", "test (synthetic) record"], is_overlay: ["flag", "scenario-overlay record"], occurred_at: ["time", "when it happened"],
      reported_at: ["time", "when reported"], closed_at: ["time", "when closed"], lang: ["dim", "language (en, ta)"],
      category_code: ["dim", "category code", J.cat], category_family: ["dim", "category family"], lead_dept: ["dim", "lead department code", J.dept],
      is_actionable: ["flag", "needs departmental action"], ward_no: ["dim", "ward", J.ward], zone_no: ["dim", "zone", J.zone],
      taluk_code: ["dim", "taluk", J.taluk], in_district: ["flag", "inside Chennai district"], dead: ["measure", "people dead", { unit: "persons" }],
      injured: ["measure", "people injured", { unit: "persons" }], persons_affected: ["measure", "people affected", { unit: "persons" }],
      weather_related: ["flag", "weather related"], severity_score: ["measure", "severity score 0-100"], severity_level: ["dim", "severity", { values: SEV }],
      status_std: ["dim", "status", { values: STATUS }], first_action_at: ["time", "first action"],
      response_minutes: ["measure", "minutes to respond", { unit: "minutes" }], reopen_count: ["measure", "times reopened"],
      channel: ["dim", "how it was reported (portal, phone, sensor, media...)"], incident_id: ["dim", "incident it was merged into", J.inc],
      has_photo: ["flag", "has a photo"]
    }
  },
  actions: {
    db: "intel", d: "Tasks: PWD field tasks and the Action Planner's playbook steps for incidents.", grain: "one row per task", time: "assigned_at", test: "1",
    cols: {
      action_id: ["id", "task ID"], incident_id: ["dim", "incident", J.inc], dept_code: ["dim", "department", J.dept], office_id: ["dim", "office", J.office],
      text: ["label", "what to do"], sop_step: ["measure", "step in the standard procedure"], assigned_at: ["time", "assigned"], due_at: ["time", "due"],
      status: ["dim", "task status"], origin: ["dim", "where the task came from"], completed_at: ["time", "completed"], verified_at: ["time", "verified"]
    }
  },
  documents: {
    db: "intel", d: "News articles (English and Tamil), PWD announcements and CFM flood bulletins. Titles and links only; article bodies are not available here.",
    grain: "one row per article or bulletin", time: "published_at", test: "source_kind = 'pwd_announcement'",
    note: "About 98% of news rows are headline snippets. The news incident filter scores F1 0.63.",
    cols: {
      doc_id: ["id", "document ID"], story_id: ["dim", "news story (same-event cluster)"], outlet_count: ["measure", "outlets in the story"],
      title: ["label", "headline", { untrusted: true }], url: ["label", "link"], publisher: ["dim", "publisher"], publisher_tier: ["dim", "publisher tier"],
      lang: ["dim", "language (en, ta)"], source_kind: ["dim", "kind", { values: ["news", "cfm_bulletin", "pwd_announcement"] }],
      report_type: ["dim", "report type (incident, civic_complaint, announcement, crime, court...)"], published_at: ["time", "published (IST)"],
      is_district: ["flag", "about Chennai district"], is_incident: ["flag", "reports an incident"], category_code: ["dim", "category", J.cat],
      department: ["dim", "department", J.dept], place_text: ["label", "place named"], dead: ["measure", "people dead", { unit: "persons" }],
      injured: ["measure", "people injured", { unit: "persons" }], linked_incident_id: ["dim", "incident it is linked to", J.inc],
      geo_level: ["dim", "how precisely it is placed"]
    }
  },
  observations: {
    db: "intel", d: "Readings over time: hospital capacity and cases, lake storage, IMD rainfall/temperature/warnings, CPCB air quality, CFM gauges and reservoir inflows.",
    grain: "one row per reading", time: "observed_at", test: "is_synthetic = 1",
    note: "The unit depends on the metric. Hospital and lake readings are test data. CPCB and CFM station positions are approximate; rainfall and air-quality history is short.",
    cols: {
      metric: ["dim", "what was measured", { values: ["aqi", "rainfall_24h_mm", "temp_max_c", "temp_min_c", "temp_departure_c", "humidity_pct", "imd_warning_level",
        "reservoir_inflow_cusec", "gauge_level_m", "lake_pct_full", "lake_storage_mcft", "lake_outflow_cusec", "bed_occupancy_pct", "occupied_beds", "total_beds",
        "emergency_cases", "opd_count", "disease_cases", "health_alert_level", "medicine_status", "ambulance_available", "vaccination_pct", "doctors_on_roll",
        "nurses_on_roll"] }],
      value: ["measure", "reading (unit in `unit`)"], unit: ["label", "unit"], place_type: ["dim", "facility or district"], place_id: ["dim", "station or facility ID"],
      place_name: ["label", "station or facility name"], lat: ["geo", "latitude"], lon: ["geo", "longitude"], ward_no: ["dim", "ward", J.ward],
      zone_no: ["dim", "zone", J.zone], taluk_code: ["dim", "taluk", J.taluk], observed_at: ["time", "when observed (IST)"], period: ["dim", "reading period"],
      source: ["dim", "source (hospital, pwd, imd, cpcb, cfm)"], quality: ["dim", "ok, suspect or derived"], is_synthetic: ["flag", "test (synthetic) reading"],
      detail: ["label", "detail: AQI band, warning text, disease", { untrusted: true }]
    }
  },
  observation_signals: {
    db: "intel", d: "Latest reading per metric and place, with descriptive references: 7-day EWMA, 28-day mean and z-score (how unusual today is). No projections.",
    grain: "one row per metric and place", time: "observed_at", test: "source IN ('hospital', 'pwd')",
    cols: {
      metric: ["dim", "what was measured (as in observations.metric)"], place_id: ["dim", "station or facility ID"], place_name: ["label", "station or facility"],
      lat: ["geo", "latitude"], lon: ["geo", "longitude"], taluk_code: ["dim", "taluk", J.taluk], observed_at: ["time", "latest reading time"],
      value: ["measure", "latest value (unit in `unit`)"], unit: ["label", "unit"], ewma7: ["measure", "7-day exponentially weighted mean"],
      mean28: ["measure", "28-day mean"], zscore: ["measure", "z-score against the last 28 days"], n_points: ["measure", "readings behind the references"],
      detail: ["label", "detail", { untrusted: true }], source: ["dim", "source (hospital, pwd, imd, cpcb, cfm)"], anomaly: ["flag", "unusual against its own history"]
    }
  },
  daily_counts: {
    db: "intel", d: "Records reported per day, zone, category and source: the history behind baselines and normal ranges.",
    grain: "one row per date, zone, category and source", time: "date", cap: "`date` <= DATE(:asOf)", test: "source IN ('grievance', 'police', 'pwd', 'hospital')",
    cols: {
      date: ["time", "day"], zone_no: ["dim", "zone", J.zone], category_code: ["dim", "category", J.cat],
      source: ["dim", "source", { values: ["grievance", "police", "pwd", "hospital", "news"] }], count: ["measure", "records reported that day"]
    }
  },
  anomalies: {
    db: "intel", d: "Unusual rises: a day, zone and category whose count was far above its usual level (Poisson baseline with a weekday factor, 28 days).",
    grain: "one row per unusual day, zone and category", time: "date", cap: "`date` <= DATE(:asOf)", test: "1",
    cols: {
      date: ["time", "day"], category_code: ["dim", "category", J.cat], zone_no: ["dim", "zone", J.zone], observed: ["measure", "reports that day"],
      expected: ["measure", "usual level"], p_value: ["measure", "chance of so many by luck"], ratio: ["measure", "times the usual level"]
    }
  },
  hotspots: {
    db: "intel", d: "Clusters of incidents close together (DBSCAN, 250 m).", grain: "one row per hotspot", time: "last_seen", test: "1",
    cols: {
      hotspot_id: ["id", "hotspot ID"], category_code: ["dim", "category", J.cat], incidents: ["measure", "incidents in the cluster"],
      incidents_30d: ["measure", "incidents in the last 30 days"], open: ["measure", "still open"], lat: ["geo", "latitude"], lon: ["geo", "longitude"],
      wards: ["label", "wards covered"], first_seen: ["time", "first incident"], last_seen: ["time", "latest incident"], top_place: ["label", "busiest place"]
    }
  },
  alerts: {
    db: "intel", d: "Alerts from the pipeline's Watchdog: unusual rises, weather warnings, lake levels, hospital alerts, incidents needing attention, deadlines, data quality.",
    grain: "one row per alert", time: "created_at", cap: "(`date` IS NULL OR `date` <= DATE(:asOf))", test: "1",
    cols: {
      alert_id: ["id", "alert ID"], type: ["dim", "alert type"], severity: ["dim", "severity"], title: ["label", "title"], message: ["label", "message"],
      explanation: ["label", "why it was raised"], place: ["label", "place"], zone_no: ["dim", "zone", J.zone], date: ["time", "day it concerns"],
      category_code: ["dim", "category", J.cat], incident_ids: ["label", "incidents behind it"], created_at: ["time", "raised"], status: ["dim", "status"]
    }
  },
  gaps: {
    db: "intel", d: "Incidents seen in the news with no department record.", grain: "one row per incident", time: "first_reported_at", test: "0",
    note: "News rests on headlines; the news incident filter scores F1 0.63.",
    cols: {
      incident_id: ["id", "incident", J.inc], title: ["label", "headline", { untrusted: true }], category_code: ["dim", "category", J.cat],
      lead_dept: ["dim", "department", J.dept], zone_name: ["label", "zone"], ward_no: ["dim", "ward", J.ward], outlet_count: ["measure", "outlets"],
      first_reported_at: ["time", "first reported"], severity_level: ["dim", "severity", { values: SEV }], priority_score: ["measure", "priority score"],
      gap_strength: ["dim", "how clear the gap is"], suggested_action: ["label", "suggested action"]
    }
  },
  review_queue: {
    db: "intel", d: "Items waiting for a person to check: uncertain links between records, locations, category mappings.", grain: "one row per item",
    time: "created_at", test: "1",
    cols: { review_id: ["id", "review ID"], item_type: ["dim", "what needs checking"], suggestion: ["label", "suggested decision"], reason: ["label", "why"],
      status: ["dim", "status"], created_at: ["time", "added"] }
  },
  source_health: {
    db: "intel", d: "Freshness of each pipeline feed at the last build.", grain: "one row per feed", test: "0", cap: null,
    cols: {
      source: ["id", "feed (grievance, police, pwd, hospital, news, imd, cpcb, cfm)"], kind: ["label", "what it is"], last_run_at: ["time", "last run"],
      last_success_at: ["time", "last success"], newest_record_at: ["time", "newest record"], freshness_target_min: ["measure", "target freshness", { unit: "minutes" }],
      minutes_since_success: ["measure", "minutes since the last success, at the build", { unit: "minutes" }], status: ["dim", "ok or stale"],
      rows: ["measure", "records"], endpoints_ok: ["measure", "endpoints working"], endpoints_total: ["measure", "endpoints"], detail: ["label", "detail"]
    }
  },
  data_quality: {
    db: "intel", d: "Data-quality checks run by the pipeline's Data Steward.", grain: "one row per check", test: "0", cap: null,
    cols: { table: ["dim", "table checked"], check: ["label", "check"], severity: ["dim", "severity"], failing: ["measure", "rows failing"],
      total: ["measure", "rows checked"], action: ["label", "what to do"] }
  },
  pwd_works: {
    db: "intel", d: "PWD works: sanctioned amount, spending and progress.", grain: "one row per work", time: "start_date",
    cap: "(`start_date` IS NULL OR `start_date` <= :asOf)", test: "1",
    cols: {
      work_id: ["id", "work ID"], work_title: ["label", "work"], work_type: ["dim", "type"], asset_id: ["dim", "asset"], office_id: ["dim", "office", J.office],
      sanctioned_amount_lakh: ["measure", "amount sanctioned", { unit: "Rs lakh" }], expenditure_lakh: ["measure", "spent so far", { unit: "Rs lakh" }],
      start_date: ["time", "started"], target_date: ["time", "target completion date"], completion_date: ["time", "completed"], status: ["dim", "status"],
      physical_progress_pct: ["measure", "physical progress", { unit: "%" }], asset_name: ["label", "asset"], latitude: ["geo", "latitude"],
      longitude: ["geo", "longitude"], taluk_code: ["dim", "taluk", J.taluk], spend_pct: ["measure", "share of the sanction spent", { unit: "%" }],
      overrun_pct: ["measure", "spending over the sanction", { unit: "%" }], progress_gap_pct: ["measure", "spending ahead of progress", { unit: "%" }],
      office: ["label", "office"]
    }
  },
  world_calendar: {
    db: "intel", d: "One calendar for all sources: rain days, festivals and protests.", grain: "one row per day", time: "date", cap: "`date` <= DATE(:asOf)", test: "1",
    note: "Rain days merge IMD warnings with the test generators' shared rain calendar.",
    cols: { date: ["time", "day"], rain_event: ["flag", "rain day"], rain_intensity: ["measure", "rain intensity 0-1"], declared_by: ["label", "which sources show rain"],
      festival: ["label", "festival"], protest: ["label", "protest"], monsoon_phase: ["dim", "monsoon phase"], weekday: ["dim", "weekday"] }
  },
  ref_wards: {
    db: "intel", d: "The 200 GCC wards with zone, taluk and ward statistics.", grain: "one row per ward", test: "0", cap: null,
    cols: {
      ward_no: ["id", "ward 1-200"], zone_no: ["dim", "zone", J.zone], zone_name: ["label", "zone name"], taluk_code: ["dim", "taluk", J.taluk],
      area_km2: ["measure", "area", { unit: "km²" }], centroid_lat: ["geo", "centre latitude"], centroid_lon: ["geo", "centre longitude"],
      flood_reports: ["measure", "flood reports", { test: true }], incidents_30d: ["measure", "incidents in 30 days", { test: true }],
      open_incidents: ["measure", "open incidents", { test: true }], open_past_deadline: ["measure", "open past deadline", { test: true }],
      low_lying_index: ["measure", "how low-lying (0-1)"], gi_star_z_30d: ["measure", "hot-spot statistic (Getis-Ord Gi*)", { test: true }],
      hot_ward: ["flag", "statistically hot ward", { test: true }]
    }
  },
  ref_zones: { db: "intel", d: "The 15 GCC zones.", grain: "one row per zone", test: "0", cap: null, cols: { zone_no: ["id", "zone 1-15"], zone_name: ["label", "zone name"] } },
  ref_taluks: {
    db: "intel", d: "Revenue taluks (17 in Chennai district, plus Tambaram outside it). Kolathur is an official taluk that the police and PWD sources do not code.",
    grain: "one row per taluk", test: "0", cap: null,
    cols: { taluk_code: ["id", "taluk code"], name: ["label", "name"], name_ta: ["label", "Tamil name"], in_district: ["flag", "inside Chennai district"],
      lat: ["geo", "latitude"], lon: ["geo", "longitude"], note: ["label", "note"] }
  },
  ref_departments: {
    db: "intel", d: "Departments that own incidents.", grain: "one row per department", test: "0", cap: null,
    cols: { code: ["id", "department code"], name: ["label", "name"], org: ["label", "organisation"], head: ["label", "head (designation)"],
      route: ["label", "escalation route"], action_owner: ["flag", "acts on incidents"] }
  },
  ref_categories: {
    db: "intel", d: "Incident categories with their lead department and resolution deadlines.", grain: "one row per category", test: "0", cap: null,
    cols: {
      category_code: ["id", "category code"], label: ["label", "category"], family: ["dim", "family"], lead_dept: ["dim", "lead department", J.dept],
      base_severity: ["measure", "base severity"], rain_sensitive: ["flag", "rises with rain"], sla_severe_h: ["measure", "deadline when severe", { unit: "hours" }],
      sla_high_h: ["measure", "deadline when high", { unit: "hours" }], sla_medium_h: ["measure", "deadline when medium", { unit: "hours" }],
      sla_low_h: ["measure", "deadline when low", { unit: "hours" }], sla_basis: ["dim", "what the deadline counts"], playbook: ["label", "standard steps"]
    }
  },
  ref_facilities: {
    db: "intel", d: "Hospitals, weather and air-quality stations, gauges, lakes and reservoirs.", grain: "one row per facility", test: "0", cap: null,
    cols: { facility_id: ["id", "facility ID"], type: ["dim", "type"], name: ["label", "name"], lat: ["geo", "latitude"], lon: ["geo", "longitude"],
      taluk_code: ["dim", "taluk", J.taluk], capacity: ["measure", "capacity (beds, mcft...)"], relevance: ["dim", "relevance to Chennai"],
      specialties: ["label", "specialties"], in_district: ["flag", "inside the district"], basin: ["dim", "river basin"] }
  },
  ref_offices: {
    db: "intel", d: "Department field offices.", grain: "one row per office", test: "0", cap: null,
    cols: { office_id: ["id", "office ID"], office_name: ["label", "office"], wing: ["dim", "wing"], designation: ["label", "officer's designation"],
      dept_code: ["dim", "department", J.dept], taluks: ["label", "taluks covered"] }
  },
  v_zone_summary: {
    db: "intel", d: "Per zone over all 180 days in the store (not period-bound): incidents, open, severe, open past deadline.", grain: "one row per zone",
    test: "1", cap: null,
    cols: { zone_no: ["id", "zone", J.zone], zone_name: ["label", "zone name"], incidents: ["measure", "incidents, all 180 days"],
      open_incidents: ["measure", "open"], severe: ["measure", "severe, all 180 days"], open_past_deadline: ["measure", "open past deadline"] }
  },
  v_department_performance: {
    db: "intel", d: "Per department over all 180 days: incidents, open, open past deadline, average hours to the first action.", grain: "one row per department",
    test: "1", cap: null,
    cols: { lead_dept: ["id", "department", J.dept], incidents: ["measure", "incidents, all 180 days"], open_incidents: ["measure", "open"],
      open_past_deadline: ["measure", "open past deadline"], avg_hours_to_first_action: ["measure", "average hours to the first action", { unit: "hours" }] }
  },
  v_taluk_unresolved: {
    db: "intel", d: "Open incidents per taluk (all open incidents, not period-bound).", grain: "one row per taluk", test: "1", cap: null,
    cols: { taluk_code: ["id", "taluk", J.taluk], taluk: ["label", "taluk name"], unresolved: ["measure", "open incidents"] }
  },
  v_media_gaps: {
    db: "intel", d: "Incidents only in the news, all 180 days.", grain: "one row per incident", time: "first_reported_at", test: "0",
    cols: { incident_id: ["id", "incident", J.inc], title: ["label", "headline", { untrusted: true }], category_label: ["label", "category"],
      zone_name: ["label", "zone"], outlet_count: ["measure", "outlets"], first_reported_at: ["time", "first reported"], priority_score: ["measure", "priority score"] }
  },
  v_collector_queue: {
    db: "intel", d: "Open incidents awaiting the Collector or flagged for attention, highest priority first.", grain: "one row per incident", test: "1", cap: null,
    cols: { incident_id: ["id", "incident", J.inc], title: ["label", "title", { untrusted: true }], severity_level: ["dim", "severity", { values: SEV }],
      zone_name: ["label", "zone"], ward_no: ["dim", "ward", J.ward], status_std: ["dim", "status", { values: STATUS }], priority_score: ["measure", "priority score"],
      priority_reasons: ["label", "why it ranks high"], attention_reason: ["label", "why it needs attention"] }
  },
  mandi_market_prices: {
    db: "ops", d: "Daily prices at each Chennai market reporting to AGMARKNET (Uzhavar Sandhai farmer markets). Koyambedu does not report.",
    grain: "one row per day, market, commodity and variety", time: "date", cap: "`date` <= DATE(:asOf)", test: "0",
    cols: { date: ["time", "day"], market: ["dim", "market"], commodity: ["dim", "commodity"], variety: ["dim", "variety"], cmdt_group: ["dim", "commodity group"],
      min_price: ["measure", "minimum price", { unit: "Rs/quintal" }], max_price: ["measure", "maximum price", { unit: "Rs/quintal" }],
      modal_price: ["measure", "most common price", { unit: "Rs/quintal" }], arrival: ["measure", "arrivals", { unit: "tonnes" }] }
  },
  mandi_prices: {
    db: "ops", d: "Daily AGMARKNET prices for Tamil Nadu and for the districts around Chennai.", grain: "one row per day, scope and commodity", time: "date",
    cap: "`date` <= DATE(:asOf)", test: "0",
    cols: { date: ["time", "day"], scope: ["dim", "area", { values: ["chennai_markets", "tamil_nadu"] }], commodity: ["dim", "commodity"],
      cmdt_group: ["dim", "commodity group"], price: ["measure", "modal price", { unit: "Rs/quintal" }], arrival: ["measure", "arrivals", { unit: "tonnes" }],
      msp: ["measure", "minimum support price", { unit: "Rs/quintal" }] }
  },
  mandi_weekly: {
    db: "ops", d: "Weekly average wholesale prices (AGMARKNET price trend) for the region around Chennai and for Tamil Nadu.",
    grain: "one row per week, scope and commodity", time: "week_start", cap: "`week_start` <= DATE(:asOf)", test: "0",
    cols: { week_start: ["time", "week start"], week_label: ["label", "week"], scope: ["dim", "area", { values: ["chennai_region", "tamil_nadu"] }],
      commodity: ["dim", "commodity"], price: ["measure", "average price", { unit: "Rs/quintal" }], districts: ["measure", "districts averaged"],
      chg_week: ["measure", "change on the previous week", { unit: "%" }], chg_month: ["measure", "change on the previous month", { unit: "%" }],
      chg_year: ["measure", "change on the previous year", { unit: "%" }] }
  },
  official_contacts: {
    db: "ops", d: "Officials published on the GCC Who's who page (department heads, zonal officers). Phone numbers and emails are not available to queries.",
    grain: "one row per official", test: "0", cap: null,
    cols: { contact_id: ["id", "contact ID"], grp: ["dim", "group"], dept_code: ["dim", "department", J.dept], zone_no: ["dim", "zone", J.zone],
      region: ["dim", "region"], rank: ["measure", "seniority within the group (1 = first)"], name: ["label", "name"], designation: ["label", "designation"],
      office: ["label", "office"], source_url: ["label", "source page"], retrieved_on: ["time", "retrieved"] }
  },
  dept_assignments: {
    // assigned_at is when the console routed it (wall clock), which can be after the data's as-of time
    db: "ops", d: "News complaints the console routed to a department officer.", grain: "one row per routed incident", time: "assigned_at", cap: null, test: "0",
    cols: { incident_id: ["id", "incident", J.inc], dept_code: ["dim", "department", J.dept], reason: ["label", "why it was routed"],
      status: ["dim", "Assigned, Acknowledged or Closed"], assigned_at: ["time", "routed"] }
  },
  sources: {
    db: "ops", d: "Data sources registered on the console: the pipeline's feeds, AGMARKNET, OCR and sources the Collector added.", grain: "one row per source",
    test: "0", cap: null,
    cols: { source_id: ["id", "source ID"], name: ["label", "name"], kind: ["dim", "kind"], description: ["label", "description"],
      pipeline_key: ["dim", "pipeline feed"], refresh_minutes: ["measure", "refresh interval", { unit: "minutes" }], enabled: ["flag", "enabled"],
      status: ["dim", "status"], last_run_at: ["time", "last run"], last_ok_at: ["time", "last success"], items_total: ["measure", "items collected"] }
  }
};

/** Tables never offered to the planner, with the reason (the drift check reports anything else it finds). */
export const EXCLUDED_TABLES: Record<string, string> = {
  "intel.forecasts": "forecasts are never used",
  "intel._export_meta": "internal; freshness comes from the source_health tool",
  "intel.agent_runs": "internal",
  "intel.link_pairs": "internal linking scores",
  "intel.metrics": "internal evaluation figures",
  // its "resolved" counts resolutions inside the window whatever the report date (1,066 this week), while the
  // console's tile counts incidents reported in the window that are now resolved (132): answers would disagree
  "intel.kpis": "the pipeline's KPI snapshot defines 'resolved' differently from the console; the overview tools give the console's numbers",
  "intel.briefings": "use the briefing tool",
  "intel.incident_members": "use the incident_detail tool",
  "intel.incident_timeline": "use the incident_detail tool; officers' notes are untrusted text",
  "intel.v_open_incidents_live": "measures age against the wall clock, not the data's as-of time",
  "ops.collector_decisions": "the Collector's own decisions; not for answers",
  "ops.action_updates": "console write table",
  "ops.review_decisions": "console write table",
  "ops.workspaces": "console write table",
  "ops.briefing_archive": "use the briefing tool",
  "ops.audit_log": "holds user emails",
  "ops.source_runs": "internal run log",
  "ops.source_items": "untrusted text from added sources; use the tools",
  // the assistant's own tables (Phase 1 onwards)
  "ops.assistant_sessions": "assistant state", "ops.assistant_messages": "assistant state", "ops.assistant_feedback": "assistant state",
  "ops.assistant_pins": "assistant state", "ops.outbound_emails": "assistant state", "ops.followups": "assistant state"
};

/** Columns deliberately left out of allowed tables (so the drift check can tell them from new, undescribed ones). */
export const PRIVATE_COLUMNS: Record<string, string[]> = {
  incidents: ["summary", "officer", "vulnerable", "severity_reasons", "priority_reasons", "attention_reason", "review_reason", "channels", "depts_involved",
    "support_depts", "occurred_at_est", "spread_m", "reliability", "sla_basis", "sla_ratio"],
  events: ["reporter_hash", "text", "title", "deep_link", "source_record_id", "snapshot_sha256", "simhash", "officer", "place_text", "lat", "lon",
    "loc_precision_m", "category_src", "subcategory_src", "dept_src", "taluk_src", "support_depts", "time_precision", "issue_age_claimed_days", "junk_flag",
    "category_conf", "category_method", "geo_level", "geo_method", "geo_conf", "affected_imputed", "vulnerable_flags", "hazard_flag", "access_blocked",
    "blockage_minutes", "service_disruption", "crowd_estimate", "claims_prior_complaint", "severity_reasons", "status_src", "status_at",
    "response_applicable", "rejection_reason_code", "assigned_office_id", "source_reliability", "dup_group_id", "link_prob", "link_method", "ext_ref",
    "ext_ref_status"],
  actions: ["event_id", "owner", "created_by", "evidence"],
  documents: ["body", "summary", "article_id", "story_role", "publisher_domain", "reliability", "fetched_at", "incident_conf", "category_conf", "lat", "lon",
    "event_id"],
  observation_signals: ["days_to_full", "slope_per_day"],
  review_queue: ["item_id", "evidence"],
  data_quality: ["examples"],
  world_calendar: ["reflected_by"],
  ref_wards: ["geometry", "adjacent_wards", "taluk_vote_share"],
  ref_zones: ["outline"],
  ref_taluks: ["police_code", "pwd_code", "aliases"],
  ref_categories: ["support_depts", "link_window_h", "link_radius_m"],
  ref_departments: ["source_names"],
  ref_facilities: ["address", "precision_m", "source", "same_as", "downstream_taluks"],
  ref_offices: ["officer_name", "phone", "email", "taluk_codes_covered"],
  mandi_market_prices: ["fetched_at"], mandi_prices: ["fetched_at"], mandi_weekly: ["fetched_at"],
  official_contacts: ["phone", "email"],
  dept_assignments: ["contact_id", "officer_name", "officer_designation", "officer_phone", "assigned_by"],
  sources: ["url", "auth", "login_url", "user_field", "pass_field", "username", "secret_enc", "session_enc", "session_expires_at", "last_error", "created_by",
    "created_at"]
};

// ------------------------------------------------------------------ catalog --

export interface SchemaSnapshot {
  generated_at?: string;
  databases?: { intel: string; ops: string };
  tables: Record<string, { kind: "table" | "view"; columns: Record<string, string> }>;
}

export interface CatalogColumn { name: string; type: string; role: ColumnRole; d: string; unit?: string; join?: string; values?: readonly string[];
  untrusted?: boolean; test?: boolean }
export interface CatalogTable {
  name: string; db: "intel" | "ops"; kind: "table" | "view"; d: string; grain: string; time?: string; cap: string | null; test: string; note?: string;
  columns: Map<string, CatalogColumn>
}
export interface Drift {
  /** described in the policy but missing from the database */
  missingTables: string[]; missingColumns: string[];
  /** in the database, neither described nor excluded: unavailable until someone describes them */
  undescribedTables: string[]; undescribedColumns: string[];
}
export interface Catalog { tables: Map<string, CatalogTable>; drift: Drift; source: "live" | "snapshot"; builtAt: string }

/** The usable catalog: policy intersected with the schema. Pure, so tests can run it on the snapshot. */
export function buildCatalog(schema: SchemaSnapshot, source: Catalog["source"] = "snapshot"): Catalog {
  const tables = new Map<string, CatalogTable>();
  const drift: Drift = { missingTables: [], missingColumns: [], undescribedTables: [], undescribedColumns: [] };
  for (const [name, spec] of Object.entries(POLICY)) {
    const live = schema.tables[`${spec.db}.${name}`];
    if (!live) { drift.missingTables.push(`${spec.db}.${name}`); continue; }
    const columns = new Map<string, CatalogColumn>();
    for (const [col, [role, d, opt]] of Object.entries(spec.cols)) {
      if (!(col in live.columns)) { drift.missingColumns.push(`${name}.${col}`); continue; }
      columns.set(col, { name: col, type: live.columns[col], role, d, ...opt });
    }
    const priv = new Set(PRIVATE_COLUMNS[name] ?? []);
    for (const col of Object.keys(live.columns)) if (!spec.cols[col] && !priv.has(col)) drift.undescribedColumns.push(`${name}.${col}`);
    const cap = spec.cap === undefined ? (spec.time ? `\`${spec.time}\` <= :asOf` : null) : spec.cap;
    tables.set(name, { name, db: spec.db, kind: live.kind, d: spec.d, grain: spec.grain, time: spec.time, cap, test: spec.test, note: spec.note, columns });
  }
  for (const key of Object.keys(schema.tables)) {
    const [db, name] = key.split(".") as ["intel" | "ops", string];
    if (!(POLICY[name]?.db === db) && !EXCLUDED_TABLES[key]) drift.undescribedTables.push(key);
  }
  return { tables, drift, source, builtAt: new Date().toISOString() };
}

/** Fully qualified name for SQL, e.g. `district_intel`.`incidents`. */
export function qualified(t: CatalogTable): string {
  return `\`${t.db === "intel" ? INTEL_DB : OPS_DB}\`.\`${t.name}\``;
}

/** True when a join between the two columns is declared (either direction). */
export function joinable(cat: Catalog, a: { table: string; column: string }, b: { table: string; column: string }): boolean {
  const ca = cat.tables.get(a.table)?.columns.get(a.column);
  const cb = cat.tables.get(b.table)?.columns.get(b.column);
  if (!ca || !cb) return false;
  return ca.join === `${b.table}.${b.column}` || cb.join === `${a.table}.${a.column}`;
}

async function introspect(): Promise<SchemaSnapshot> {
  const [rows] = await intelPool.query<RowDataPacket[]>(
    `SELECT c.table_schema AS db, c.table_name AS t, c.column_name AS c, c.column_type AS type, tb.table_type AS kind
     FROM information_schema.columns c
     JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema IN (?, ?) ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    [INTEL_DB, OPS_DB]
  );
  const tables: SchemaSnapshot["tables"] = {};
  for (const r of rows) {
    const key = `${r.db === INTEL_DB ? "intel" : "ops"}.${r.t}`;
    tables[key] ??= { kind: r.kind === "VIEW" ? "view" : "table", columns: {} };
    tables[key].columns[r.c] = String(r.type);
  }
  return { tables, databases: { intel: INTEL_DB, ops: OPS_DB } };
}

let cached: { key: string; cat: Catalog } | null = null;

/** The catalog over the live schema, rebuilt after each pipeline export; the committed snapshot if the database cannot be read. */
export async function loadCatalog(): Promise<Catalog> {
  const key = await exportMeta().then((m) => m.exported_at ?? "").catch(() => "offline");
  if (cached && cached.key === key) return cached.cat;
  let cat: Catalog;
  try {
    cat = buildCatalog(await introspect(), "live");
  } catch (e) {
    console.warn("assistant catalog: information_schema unavailable, using schema.snapshot.json:", (e as Error).message);
    cat = buildCatalog(snapshotFile as unknown as SchemaSnapshot, "snapshot");
  }
  cached = { key, cat };
  return cat;
}

/** The catalog as compact text for the planner prompt: one block per table, one line of columns. */
export function renderCatalog(cat: Catalog, only?: string[]): string {
  const out: string[] = [];
  for (const t of cat.tables.values()) {
    if (only && !only.includes(t.name)) continue;
    const head = [`${t.name} — ${t.d} (${t.grain}).`, t.time ? `Time: ${t.time}.` : "", `Test data: ${t.test === "0" ? "none" : t.test === "1" ? "includes test data" : t.test}.`,
      t.note ?? ""].filter(Boolean).join(" ");
    const cols = [...t.columns.values()].map((c) => {
      const bits: string[] = [c.role];
      if (c.unit) bits.push(c.unit);
      if (c.join) bits.push(`→${c.join}`);
      if (c.values) bits.push(`[${c.values.join("|")}]`);
      return `${c.name} (${bits.join(", ")}): ${c.d}`;
    });
    out.push(`${head}\n  ${cols.join("; ")}`);
  }
  return out.join("\n");
}
