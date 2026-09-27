"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CircleDot,
  Clock,
  CloudRain,
  Droplets,
  FileWarning,
  Gauge,
  Hospital,
  Layers,
  Newspaper,
  ShieldAlert,
  Thermometer,
  Users,
  Wind
} from "lucide-react";
import type { Decision, Overview, PeriodKey } from "@/lib/collector/queries";
import TrendChart from "@/components/collector/TrendChart";
import IncidentDrawer from "@/components/collector/IncidentDrawer";
import { DecisionChip, Panel, SeverityChip, fmtDate, fmtDateTime, fmtHours, fmtNum } from "@/components/collector/ui";

const WardMap = dynamic(() => import("@/components/collector/WardMap"), {
  ssr: false,
  loading: () => <div className="skeleton h-full min-h-[320px]" />
});

const PERIOD_TABS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "quarter", label: "Quarter" }
];

export default function CollectorDashboard({ data }: { data: Overview }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [queueFilter, setQueueFilter] = useState<"pending" | "all">("pending");

  const queue = useMemo(() => {
    const merged = data.queue.map((q) => ({ ...q, decision: decisions[q.incident_id] ?? q.decision }) as typeof q);
    return queueFilter === "pending" ? merged.filter((q) => !q.decision) : merged;
  }, [data.queue, decisions, queueFilter]);

  const cur = data.kpi.current;
  const prev = data.kpi.previous;
  const staleSources = data.health.filter((h) => h.status !== "ok");

  return (
    <div className="flex flex-col gap-4">
      {/* Title strip */}
      <section className="relative overflow-hidden rounded-2xl px-5 py-4 text-white shadow-card mesh-navy">
        <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="eyebrow text-navy-200">Chennai district · Collector</p>
            <h1 className="text-xl font-extrabold sm:text-2xl">District intelligence</h1>
          </div>
          <nav className="flex rounded-xl bg-white/10 p-1 ring-1 ring-white/20" aria-label="Period">
            {PERIOD_TABS.map((t) => (
              <Link
                key={t.key}
                href={`/collector?p=${t.key}`}
                scroll={false}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  data.period === t.key ? "bg-white text-navy shadow-soft" : "text-navy-100 hover:bg-white/10"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto text-right text-xs leading-relaxed text-navy-100">
            <div>
              Data as of <b className="text-white">{fmtDateTime(data.asOf)}</b>
            </div>
            <div>
              {staleSources.length === 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <i className="h-2 w-2 rounded-full bg-emerald-400" /> All 8 sources reporting
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <i className="h-2 w-2 rounded-full bg-amber-400" />
                  {staleSources.map((s) => s.source.toUpperCase()).join(", ")} {staleSources.length === 1 ? "is" : "are"} degraded
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* KPI tiles */}
      {cur && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi icon={<Layers />} label="Incidents" value={cur.incidents} prev={prev?.incidents} periodLabel={data.periodLabel} />
          <Kpi icon={<ShieldAlert />} label="Severe" value={cur.severe_incidents} prev={prev?.severe_incidents} tone="red"
            periodLabel={data.periodLabel} />
          <Kpi icon={<CircleDot />} label="Open now" value={cur.open_incidents} prev={prev?.open_incidents} periodLabel={data.periodLabel} />
          <Kpi icon={<Clock />} label="Open past deadline" value={cur.sla_breached_open} prev={prev?.sla_breached_open} tone="red"
            periodLabel={data.periodLabel} />
          <Kpi icon={<Users />} label="Complaints filed" value={cur.complaints_filed} prev={prev?.complaints_filed}
            periodLabel={data.periodLabel} neutral />
          <Kpi
            icon={<Gauge />}
            label="Median hours to first action"
            value={cur.median_hours_to_first_action}
            prev={prev?.median_hours_to_first_action}
            periodLabel={data.periodLabel}
            decimals={1}
          />
        </section>
      )}

      {/* Map, priority list, alerts */}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
        <Panel title="Ward map" hint="200 GCC wards" className="h-[560px] lg:row-span-2 lg:h-[780px] 2xl:row-span-1 2xl:h-[640px]">
          <WardMap wards={data.wards} pins={data.pins} onOpenIncident={setOpenId} />
        </Panel>

        <Panel
          title="Needs your decision"
          hint={`${data.queue.length} flagged`}
          className="h-[520px] lg:h-[382px] 2xl:h-[640px]"
          bodyClassName="overflow-y-auto"
          action={
            <div className="flex rounded-lg bg-canvas-sunken p-0.5 text-2xs font-semibold">
              {(["pending", "all"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setQueueFilter(f)}
                  className={`rounded-md px-2 py-1 ${queueFilter === f ? "bg-white text-navy shadow-xs" : "text-ink-muted"}`}
                >
                  {f === "pending" ? "Not decided" : "All"}
                </button>
              ))}
            </div>
          }
        >
          {queue.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-subtle">Nothing waiting. Every flagged incident has a decision.</p>
          ) : (
            <ul className="divide-y divide-canvas-border">
              {queue.map((q) => (
                <li key={q.incident_id}>
                  <button
                    onClick={() => setOpenId(q.incident_id)}
                    className="flex w-full flex-col gap-1 rounded-lg px-2 py-2.5 text-left transition hover:bg-navy-50"
                  >
                    <span className="flex items-center gap-2">
                      <SeverityChip level={q.severity_level} />
                      <span className="truncate text-sm font-semibold text-ink">{q.title || q.category_label}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
                      <span>
                        {q.zone_name ?? "?"}
                        {q.ward_no ? `, ward ${q.ward_no}` : ""}
                      </span>
                      <span>· {q.lead_dept}</span>
                      <span>· open {fmtHours(q.hours_open)}</span>
                      {!!q.sla_breached && <span className="font-semibold text-red-700">· past deadline</span>}
                      <DecisionChip decision={q.decision} />
                    </span>
                    {q.attention_reason && <span className="line-clamp-1 text-xs text-ink-muted">{q.attention_reason}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Alerts" hint={`${data.alerts.length} new`} className="h-[520px] lg:h-[382px] 2xl:h-[640px]" bodyClassName="overflow-y-auto">
          <ul className="space-y-2">
            {data.alerts.map((a) => {
              const first = String(a.incident_ids ?? "").split(/[|,\s"[\]]+/).find(Boolean);
              return (
                <li key={a.alert_id}>
                  <button
                    disabled={!first}
                    onClick={() => first && setOpenId(first)}
                    className="flex w-full gap-2.5 rounded-xl border border-canvas-border p-2.5 text-left transition enabled:hover:border-navy-200 enabled:hover:bg-navy-50"
                  >
                    <AlertIcon type={a.type} severity={a.severity} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-snug text-ink">{a.title}</span>
                      <span className="block text-xs text-ink-muted">{a.message}</span>
                      <span className="block text-2xs text-ink-subtle">
                        {[a.place, a.date ? fmtDate(a.date) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      {/* Trend and environment */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Records per day" hint="all departments and news, last 30 days">
          <TrendChart trend={data.trend} calendar={data.calendar} />
        </Panel>
        <Panel title="Environment" hint="latest readings">
          <Environment rows={data.environment} />
        </Panel>
      </div>

      {/* Gaps, briefing, source health */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="In the news, not on record" hint="no department has logged these" bodyClassName="max-h-[380px] overflow-y-auto">
          <ul className="divide-y divide-canvas-border">
            {data.gaps.map((g) => (
              <li key={g.incident_id}>
                <button onClick={() => setOpenId(g.incident_id)} className="w-full rounded-lg px-1 py-2 text-left hover:bg-navy-50">
                  <span className="line-clamp-2 text-sm font-medium text-ink">{g.title}</span>
                  <span className="text-xs text-ink-subtle">
                    {g.zone_name ?? "?"} · {g.outlet_count} outlet{g.outlet_count === 1 ? "" : "s"} · {fmtDate(g.first_reported_at)} ·{" "}
                    {g.suggested_action}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Briefing" hint={data.briefing ? `${data.briefing.period} · ${fmtDateTime(data.briefing.as_of)}` : undefined}
          bodyClassName="max-h-[380px] overflow-y-auto">
          {data.briefing ? <Briefing markdown={data.briefing.markdown} /> : <p className="text-sm text-ink-subtle">No briefing yet.</p>}
        </Panel>

        <Panel title="Data sources" hint="freshness of every feed">
          <ul className="divide-y divide-canvas-border text-sm">
            {data.health.map((h) => (
              <li key={h.source} className="flex items-center gap-2 py-1.5">
                <i
                  className={`h-2 w-2 flex-none rounded-full ${
                    h.status === "ok" ? "bg-emerald-500" : h.status === "degraded" ? "bg-amber-500" : "bg-red-500"
                  }`}
                />
                <span className="w-20 font-semibold uppercase text-ink">{h.source}</span>
                <span className="truncate text-xs text-ink-subtle">{h.kind}</span>
                <span className="ml-auto flex-none text-xs text-ink-muted" title="newest record">
                  {fmtDateTime(h.newest_record_at)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-ink-subtle">Exported to the dashboard {fmtDateTime(data.exportedAt)}.</p>
        </Panel>
      </div>

      {openId && (
        <IncidentDrawer
          incidentId={openId}
          onClose={() => setOpenId(null)}
          onDecision={(d) => d.decision !== "note" && setDecisions((m) => ({ ...m, [d.incident_id]: d }))}
        />
      )}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  prev,
  periodLabel,
  tone,
  neutral,
  decimals = 0
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  prev?: number | null;
  periodLabel: string;
  tone?: "red";
  neutral?: boolean;
  decimals?: number;
}) {
  const delta = value != null && prev != null ? value - prev : null;
  const pct = delta != null && prev ? Math.round((delta / prev) * 100) : null;
  // For every tile except complaints filed, fewer is better.
  const good = delta == null || neutral ? null : delta <= 0;
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-canvas-border bg-white p-3.5 shadow-soft">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
        <span className={`[&>svg]:h-4 [&>svg]:w-4 ${tone === "red" ? "text-red-600" : "text-navy"}`}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`font-display text-2xl font-extrabold tabular-nums ${tone === "red" ? "text-red-700" : "text-ink"}`}>
        {value == null ? "—" : decimals ? value.toFixed(decimals) : fmtNum(value)}
      </div>
      <div className="flex items-center gap-1 text-2xs text-ink-subtle">
        {delta != null && delta !== 0 && (
          <span
            className={`inline-flex items-center rounded px-1 font-semibold ${
              good == null ? "bg-canvas-sunken text-ink-muted" : good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {pct != null ? `${Math.abs(pct)}%` : Math.abs(delta).toFixed(decimals)}
          </span>
        )}
        <span>vs previous {periodLabel.toLowerCase()}</span>
      </div>
    </div>
  );
}

function AlertIcon({ type, severity }: { type: string; severity: string }) {
  const cls = `mt-0.5 h-8 w-8 flex-none rounded-lg p-1.5 ${
    severity === "Severe" || severity === "High" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
  }`;
  if (type === "weather_warning") return <CloudRain className={cls} />;
  if (type === "anomaly") return <AlertTriangle className={cls} />;
  if (type.includes("hospital") || type.includes("health")) return <Hospital className={cls} />;
  if (type.includes("lake") || type.includes("reservoir")) return <Droplets className={cls} />;
  return <FileWarning className={cls} />;
}

function Environment({ rows }: { rows: Overview["environment"] }) {
  const by = (m: string) => rows.filter((r) => r.metric === m);
  const max = (m: string) => by(m).reduce<(typeof rows)[number] | null>((a, r) => (!a || r.value > a.value ? r : a), null);
  const avg = (m: string) => {
    const v = by(m).map((r) => Number(r.value)).filter((x) => !Number.isNaN(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const rain = max("rainfall_24h_mm");
  const aqi = max("aqi");
  const temp = max("temp_max_c");
  const beds = avg("bed_occupancy_pct");
  const warn = max("imd_warning_level");
  const lakes = by("lake_pct_full").sort((a, b) => b.value - a.value).slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <EnvTile icon={<CloudRain />} label="Rain, last 24 h" value={rain ? `${rain.value} mm` : "—"} sub={rain?.place_name} />
        <EnvTile icon={<Wind />} label="Worst AQI" value={aqi ? `${Math.round(aqi.value)}` : "—"} sub={aqi ? `${aqi.detail ?? ""} · ${aqi.place_name}` : undefined} />
        <EnvTile icon={<Thermometer />} label="Max temperature" value={temp ? `${temp.value} °C` : "—"} sub={temp?.place_name} />
        <EnvTile icon={<Hospital />} label="Hospital beds used" value={beds != null ? `${Math.round(beds)}%` : "—"} sub="average, 9 govt hospitals" />
      </div>
      {warn && Number(warn.value) > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
          IMD warning level {warn.value} in force{warn.detail ? `: ${warn.detail}` : ""}
        </p>
      )}
      <div>
        <p className="mb-1 text-2xs font-bold uppercase tracking-[0.1em] text-navy">Lakes and reservoirs, % full</p>
        <ul className="space-y-1">
          {lakes.map((l) => (
            <li key={l.place_name} className="grid grid-cols-[minmax(0,1fr)_2fr_3rem] items-center gap-2 text-xs">
              <span className="truncate text-ink-muted">{l.place_name}</span>
              <span className="h-2 overflow-hidden rounded-full bg-canvas-sunken">
                <span
                  className={`block h-full rounded-full ${l.value >= 90 ? "bg-red-500" : l.value >= 75 ? "bg-amber-500" : "bg-navy-400"}`}
                  style={{ width: `${Math.min(100, Math.max(0, l.value))}%` }}
                />
              </span>
              <span className="text-right font-semibold tabular-nums text-ink">{Math.round(l.value)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EnvTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-canvas-border bg-canvas px-3 py-2">
      <div className="flex items-center gap-1.5 text-2xs font-semibold text-ink-subtle [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
        {label}
      </div>
      <div className="font-display text-lg font-extrabold tabular-nums text-ink">{value}</div>
      {sub && <div className="truncate text-2xs text-ink-subtle">{sub}</div>}
    </div>
  );
}

/** The pipeline's briefings are short markdown: headings, bullets, bold, italics and tables. */
function Briefing({ markdown }: { markdown: string }) {
  // Group consecutive "| a | b |" lines into tables; everything else stays a line.
  const blocks: (string | string[][])[] = [];
  for (const raw of String(markdown ?? "").split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; // header separator
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      const last = blocks[blocks.length - 1];
      if (Array.isArray(last)) last.push(cells);
      else blocks.push([cells]);
    } else {
      blocks.push(line);
    }
  }
  return (
    <div className="space-y-1 text-sm text-ink-muted">
      {blocks.map((line, i) => {
        if (Array.isArray(line)) {
          const [head, ...body] = line;
          return (
            <div key={i} className="overflow-x-auto py-1">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {head.map((c, j) => (
                      <th key={j} className="whitespace-nowrap bg-canvas-sunken px-2 py-1 text-left font-semibold text-ink-subtle">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((r, k) => (
                    <tr key={k} className="border-b border-canvas-border">
                      {r.map((c, j) => (
                        <td key={j} className="px-2 py-1 align-top">
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (!line.trim()) return null;
        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
          return (
            <p key={i} className={`${h[1].length <= 2 ? "text-base" : "text-sm"} pt-1 font-bold text-ink`}>
              {inline(h[2])}
            </p>
          );
        }
        const b = line.match(/^\s*[-*]\s+(.*)$/);
        if (b) {
          return (
            <p key={i} className="relative pl-4">
              <span className="absolute left-1 top-2 h-1 w-1 rounded-full bg-navy-400" />
              {inline(b[1])}
            </p>
          );
        }
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|_[^_]+_|(?:^|\s)_[^_]+_(?=\s|$))/g).map((part, i) => {
    const t = part.trim();
    if (t.startsWith("**") && t.endsWith("**")) {
      return (
        <b key={i} className="font-semibold text-ink">
          {t.slice(2, -2)}
        </b>
      );
    }
    if (t.length > 2 && t.startsWith("_") && t.endsWith("_")) {
      return (
        <i key={i} className="text-ink-subtle">
          {part.startsWith(" ") ? " " : ""}
          {t.slice(1, -1)}
        </i>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
