"use client";

/* The officer dashboard's cards. Each takes the console context `c` and renders one panel of the demo layout. */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import SatMap from "@/components/collector/app/SatMap";
import { I } from "@/components/collector/app/icons";
import { Chart, Empty, HBars, SEV_HEX, SevChip, fullTitle, rel, useSize, type Row } from "@/components/collector/app/lib";
import { STAGE_CLASS, STAGE_LABEL, STAGE_SHORT, TABS, TAB_LABEL, type Stage, type Tab } from "@/lib/officer/stages";
import { bucketLabels } from "./format";
import type { InsightModule } from "@/lib/officer/insights";
import { MODULE_ICON } from "./Insights";
import type { Ctx } from "./OfficerApp";

const NONE: Row[] = [];
const noop = () => undefined;

// ------------------------------------------------------------ small parts --

/** Stage chip; a grievance the Collector sent back shows "Returned" (in the table, instead of "In action"). */
export function StageChip({ r, compact }: { r: Row; compact?: boolean }) {
  const s = r.stage as Stage;
  const returned = r.returned && (s === "action" || s === "approved");
  const note = returned ? `Returned by the Collector${r.returnNote ? `: ${r.returnNote}` : ""}` : undefined;
  if (compact && returned) return <span className="chip sev-high" title={note}><I n="refresh" />Returned</span>;
  if (compact) return <span className={`st ${STAGE_CLASS[s] ?? "st-open"}`} title={STAGE_LABEL[s]}>{STAGE_SHORT[s] ?? s}</span>;
  return (
    <>
      <span className={`st ${STAGE_CLASS[s] ?? "st-open"}`}>{STAGE_LABEL[s] ?? s}</span>
      {returned ? <> <span className="chip sev-high" title={note}>Returned</span></> : null}
    </>
  );
}

/** The one thing the officer can do next: approve a new grievance, or complete and send one in action. */
export function NextStep({ r, c }: { r: Row; c: Ctx }) {
  const busy = c.busy.has(r.id);
  const run = (e: React.MouseEvent, f: () => void) => { e.stopPropagation(); f(); };
  switch (r.stage as Stage) {
    case "new":
      return <button className="btn sm" disabled={busy} onClick={(e) => run(e, () => c.approve(r))}><I n="check" />Approve</button>;
    case "approved":
    case "action":
      return <button className="btn sm ok" disabled={busy} onClick={(e) => run(e, () => c.openSend(r))}><I n="send" />Complete &amp; send</button>;
    case "sent":
      return <span className="dim" style={{ fontSize: 12.5 }}>Awaiting Collector</span>;
    default:
      return <span className="chip sev-low"><I n="check" />Verified</span>;
  }
}

/** Where the grievance came from, as compact icons with counts (hover for the words). */
export function SourceIcons({ r }: { r: Row }) {
  const s = String(r.sources ?? "").split("|");
  const n = Number(r.complaints), o = Number(r.outlets);
  const out: React.ReactNode[] = [];
  if (n > 0 || s.includes("grievance")) out.push(<span key="g" className="osi chip-portal" title={`Grievance portal: ${n} citizen complaint${n === 1 ? "" : "s"}`}><I n="app" />{n || ""}</span>);
  if (o > 0 || s.includes("news")) out.push(<span key="n" className="osi chip-src" title={`News: ${o} outlet${o === 1 ? "" : "s"}`}><I n="news" />{o || ""}</span>);
  if (s.includes("police")) out.push(<span key="p" className="osi chip-pol" title="Police record"><I n="shield" /></span>);
  if (s.includes("pwd")) out.push(<span key="w" className="osi chip-src" title="PWD field record"><I n="doc" /></span>);
  return out.length ? <>{out}</> : <span className="dim">—</span>;
}

// ------------------------------------------------------------------- map --

export function MapCard({ c, style }: { c: Ctx; style?: CSSProperties }) {
  const d = c.ov;
  const layers = useMemo(() => ({ Severe: true, High: true, Medium: true, Low: true, added: false, stations: false }), []);
  const pins = useMemo(() => d.map.pins.map((p) => ({ ...p, status: STAGE_LABEL[p.stage as Stage] ?? p.stage })), [d.map.pins]);
  return (
    <article className="card o-map" style={style}>
      <div className="ch"><I n="map" /><h3>{c.dept.short} Grievance Map</h3></div>
      <div className="map-cb">
        <div className="map-wrap">
          <SatMap geo={c.geo} zoneCounts={d.map.zoneCounts} pins={pins} zone={c.zone} layers={layers} stations={[]} added={NONE}
            mode={c.taluk ? "taluks" : "zones"} taluk={c.taluk} focus={null} onZone={(z) => c.setZone(z)} onTaluk={(t) => c.setTaluk(t)}
            onPin={(id) => c.openGrievance(id)} onStation={noop} onItem={noop} zoneTip={c.zoneTip} pinColor={(p) => SEV_HEX[p.sev] ?? "#4D8DFF"} />
          <div className="map-leg">
            {d.map.sevCounts.map((s) => <span key={s.sev}><i style={{ background: SEV_HEX[s.sev] }} />{s.sev} ({s.n})</span>)}
          </div>
          {!c.taluk && <div className="map-heat"><span>Open grievances by zone</span><div /><span><em style={{ fontStyle: "normal" }}>Fewer</em><em style={{ fontStyle: "normal" }}>More</em></span></div>}
        </div>
      </div>
    </article>
  );
}

// ------------------------------------------------------------ grievances --

/** column widths (%): grievance and place, severity, reported / updated, next step */
const COLS = [42, 15, 18, 25];
/** table header and row heights (px) at the card's font size, for fitting whole rows */
const ROW_H = { head: 33, row: 47 };

const EMPTY: Record<Tab, string> = {
  new: "No new grievances in this period.",
  action: "Nothing in action right now.",
  sent: "No reports waiting for the Collector.",
  verified: "Nothing verified in this period."
};

/** The grievance board: one tab per workflow stage, the one step each grievance needs, as many rows as fit. */
export function GrievancesCard({ c, style }: { c: Ctx; style?: CSSProperties }) {
  const [wrap, size] = useSize<HTMLDivElement>();
  const { setPer, fit } = c;
  // as many rows as fit the card (the console never scrolls on desktop); phones get a fixed page
  useEffect(() => {
    if (!fit) setPer(8);
    else if (size.h > 0) setPer(Math.max(3, Math.floor((size.h - ROW_H.head) / ROW_H.row)));
  }, [size.h, fit, setPer]);

  const L = c.list;
  const counts: Record<Tab, number> = { new: c.ov.counts.new, action: c.ov.counts.action, sent: c.ov.counts.sent, verified: c.ov.counts.verified };
  const from = L && L.total ? L.page * L.per + 1 : 0;
  const to = L ? Math.min(L.total, L.page * L.per + L.rows.length) : 0;
  const pages = L ? Math.max(1, Math.ceil(L.total / L.per)) : 1;
  const recent = c.tab === "new" || c.tab === "action";
  return (
    <article className="card o-q" id="o-queue" style={style}>
      <div className="ch"><I n="tasks" /><h3>Grievances <span>· Approve → Complete &amp; send → Collector verifies</span></h3>
        <span className="pgr">
          <span>{from}–{to} of {L?.total.toLocaleString("en-IN") ?? "…"}</span>
          <button onClick={() => c.setPage((L?.page ?? 0) - 1)} disabled={!L || L.page <= 0} aria-label="Previous page"><I n="chevl" /></button>
          <button onClick={() => c.setPage((L?.page ?? 0) + 1)} disabled={!L || L.page >= pages - 1} aria-label="Next page"><I n="chevr" /></button>
        </span>
      </div>
      <div className="btabs oq-tabs" role="tablist" aria-label="Grievances">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={c.tab === t} className={c.tab === t ? "on" : ""} onClick={() => c.setTab(t)}>
            {TAB_LABEL[t]} <b className="tab-n">{counts[t].toLocaleString("en-IN")}</b>
          </button>
        ))}
      </div>
      <div className="cb">
        <div className="tbl-wrap" ref={wrap}>
          <table>
            <colgroup>{COLS.map((w, k) => <col key={k} style={{ width: `${w}%` }} />)}</colgroup>
            <thead><tr><th>Grievance</th><th>Severity</th><th>{recent ? "Reported" : "Updated"}</th><th>Next step</th></tr></thead>
            <tbody style={{ opacity: c.listLoading && L ? 0.55 : 1 }}>
              {c.listError ? (
                <tr><td colSpan={4}><div className="o-state err"><I n="alert" />{c.listError}<button className="btn sm plain" onClick={c.retryList}>Try again</button></div></td></tr>
              ) : !L ? (
                Array.from({ length: 5 }, (_, k) => <tr key={k} className="o-skel">{Array.from({ length: 4 }, (_, j) => <td key={j}><span /></td>)}</tr>)
              ) : L.rows.length ? (
                L.rows.map((r) => (
                  <tr key={r.id} className={r.id === c.fresh ? "flash" : ""} onClick={() => c.openGrievance(r.id)} title={`${r.id} · ${fullTitle(r)}`}>
                    <td className="oq-g">
                      <b>{r.type}{r.returned && <span className="chip sev-high" title={r.returnNote ?? "Returned by the Collector"}><I n="refresh" />Returned</span>}</b>
                      <small>{[r.loc, r.zone_name ?? "Chennai"].filter(Boolean).join(" · ")}{r.complaints ? ` · ${r.complaints} complaint${r.complaints === 1 ? "" : "s"}` : ""}{r.outlets ? " · in the news" : ""}</small>
                    </td>
                    <td><SevChip s={r.sev} /></td>
                    <td className="dim">{rel(recent ? r.t : r.updated, c.now)}</td>
                    <td><NextStep r={r} c={c} /></td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4}><Empty>{EMPTY[c.tab]}</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ news --

export function NewsCard({ c, style }: { c: Ctx; style?: CSSProperties }) {
  const items = c.ov.news;
  return (
    <article className="card o-news" style={style}>
      <div className="ch"><I n="news" /><h3>{c.dept.short} in the News <span>· {c.ov.periodInfo.label}</span></h3><span className="cnt-b">{items.length}</span></div>
      <div className="o-list">
        {items.length ? items.map((i) => (
          <button key={i.id} className="brief" onClick={() => c.openGrievance(i.id, "news")}>
            <span className="bic t-info"><I n="news" /></span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <b>{fullTitle(i)}</b>
              <span className="loc">{i.zone_name ?? "Chennai"} · {i.type} · {rel(i.t, c.now)}</span>
              {i.summary && <p>{i.summary}</p>}
              <span className="news-ol">Reported by {i.outletNames.length || i.outlets}:{i.outletNames.map((n: string) => <span key={n} className="chip chip-np">{n}</span>)}</span>
            </span>
          </button>
        )) : <Empty>No news reports in this period.</Empty>}
      </div>
    </article>
  );
}

// ----------------------------------------------------------------- trend --

/** Grievances reported across the period, in the Collector's buckets (2 hours, a day or a week). */
export function TrendCard({ c, style }: { c: Ctx; style?: CSSProperties }) {
  const [cat, setCat] = useState("all");
  const P = c.ov.periodInfo;
  const series = c.ov.trend;
  const pickSeries = series.find((s) => s.code === cat);
  const vals = cat === "all" || !pickSeries
    ? Array.from({ length: P.buckets }, (_, k) => series.reduce((sum, s) => sum + (s.v[k] ?? 0), 0))
    : pickSeries.v;
  const labels = bucketLabels(c.ov.since, P, c.ov.period);
  const total = vals.reduce((s, v) => s + v, 0);
  return (
    <article className="card o-tr" style={style}>
      <div className="ch"><I n="chart" /><h3>Trend <span>· {P.label}</span></h3></div>
      <div className="cb">
        <select className="sel" value={pickSeries ? cat : "all"} onChange={(e) => setCat(e.target.value)} aria-label="Grievance type">
          <option value="all">All {c.dept.short} grievances</option>
          {series.map((s) => <option key={s.code} value={s.code}>{s.l}</option>)}
        </select>
        {total ? <Chart kind="bar" vals={vals} labels={labels} fmt={(v) => `${v.toLocaleString("en-IN")} grievances`} />
          : <Empty>No grievances reported in this period.</Empty>}
      </div>
    </article>
  );
}

// ------------------------------------------------------- type, area, feedback --

export function TypeCard({ c, style }: { c: Ctx; style?: CSSProperties }) {
  const rows = c.ov.byType;
  return (
    <article className="card o-cat" style={style}>
      <div className="ch"><I n="chart" /><h3>Complaints by Type <span>· {c.ov.periodInfo.label}</span></h3></div>
      <div className="cb">
        {rows.length ? <HBars rows={rows.map((r) => ({ l: r.l, v: r.v, onClick: () => c.openList(r.code, r.l) }))} /> : <Empty>No complaints in this period.</Empty>}
      </div>
    </article>
  );
}

/** Open grievances by zone, then (with a zone chosen) by taluk, then (with a taluk chosen) by ward. */
export function AreaCard({ c, style }: { c: Ctx; style?: CSSProperties }) {
  const { level, rows } = c.ov.byArea;
  const title = level === "zone" ? "Open by Zone" : level === "taluk" ? "Open by Taluk" : "Open by Ward";
  const scope = level === "taluk" ? c.zoneName : level === "ward" ? c.talukName : null;
  const click = (key: string) => (level === "zone" ? () => c.setZone(Number(key)) : level === "taluk" ? () => c.setTaluk(key) : undefined);
  return (
    <article className="card o-area" style={style}>
      <div className="ch"><I n="pin" /><h3>{title}{scope ? <span> · {scope}</span> : null}</h3></div>
      <div className="cb">
        {rows.length ? <HBars rows={rows.map((r) => ({ l: r.l, v: r.v, onClick: click(r.key) }))} /> : <Empty>No open grievances</Empty>}
      </div>
    </article>
  );
}

export function FeedbackCard({ c, style }: { c: Ctx; style?: CSSProperties }) {
  const items = c.ov.feedback;
  return (
    <article className="card o-fb" style={style}>
      <div className="ch"><I n="shield" /><h3>Collector Feedback</h3></div>
      <div className="o-list">
        {items.length ? items.map((f) => (
          <button key={f.did} className="brief" onClick={() => c.openGrievance(f.id)}>
            <span className={`bic ${f.ok ? "t-low" : "t-high"}`}><I n={f.ok ? "checkc" : "refresh"} /></span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <b>{f.title ?? f.type}</b>
              <span className="loc">{f.ok ? `Verified · ${rel(f.at, c.now)}` : `Returned · ${f.note || "no note"}`}</span>
            </span>
          </button>
        )) : <Empty>No decisions in this period.</Empty>}
      </div>
    </article>
  );
}

// ------------------------------------------------------------ priorities --

interface Priority { key: string; tone: string; icon: Parameters<typeof I>[0]["n"]; title: string; sub: string; run: () => void }

/**
 * What needs the officer now, most urgent first: severe grievances to approve, work the Collector sent back,
 * deadlines missed and about to be missed, the grievance waiting longest, and the first finding of each store
 * source that concerns the department (a warning, a full lake, a hospital near capacity, a rising complaint type).
 * Every line is a figure from the store and opens the list or detail behind it.
 */
export function PrioritiesCard({ c, modules, openModule, style }: {
  c: Ctx; modules: InsightModule[] | null; openModule: (key: string) => void; style?: CSSProperties;
}) {
  const k = c.ov.counts;
  const P = c.ov.periodInfo.label.toLowerCase();
  const items: Priority[] = [];
  const n = (v: number) => v.toLocaleString("en-IN");
  if (k.new) items.push({
    key: "new", tone: k.newSerious ? "t-sev" : "t-info", icon: "bell",
    title: `${n(k.new)} new grievance${k.new === 1 ? "" : "s"} waiting for your approval`,
    sub: k.newSerious ? `${n(k.newSerious)} of them severe or high: approve these first` : `Reported ${P}`, run: () => c.setTab("new")
  });
  if (k.returned) items.push({
    key: "returned", tone: "t-high", icon: "refresh", title: `${n(k.returned)} returned by the Collector for rework`,
    sub: "Redo the work and send a fresh completion report", run: () => c.setTab("action")
  });
  if (k.overdue) items.push({
    key: "overdue", tone: "t-sev", icon: "clock", title: `${n(k.overdue)} open past the deadline`,
    sub: c.ov.topZone ? `Most open work in ${c.ov.topZone.name} (${n(c.ov.topZone.n)})` : "Close or escalate them today", run: () => c.openList(null, "Past deadline, still open", "overdue")
  });
  if (k.due) items.push({
    key: "due", tone: "t-high", icon: "timer", title: `${n(k.due)} due within the next 24 hours`,
    sub: "Not late yet: finish these before they cross the deadline", run: () => c.openList(null, "Due within 24 hours", "due")
  });
  const o = c.ov.oldest;
  if (o) items.push({
    key: "oldest", tone: "t-violet", icon: "tasks", title: `Waiting longest: ${o.type}${o.loc ? `, ${o.loc}` : ""}`,
    sub: `Reported ${rel(o.t, c.now)} · ${STAGE_LABEL[o.stage as Stage] ?? o.stage}${o.zone_name ? ` · ${o.zone_name}` : ""}`, run: () => c.openGrievance(o.id)
  });
  if (k.sent) items.push({
    key: "sent", tone: "t-violet", icon: "send", title: `${n(k.sent)} report${k.sent === 1 ? "" : "s"} waiting for the Collector's check`,
    sub: "Nothing to do until the Collector decides", run: () => c.setTab("sent")
  });
  // the first finding of every source that concerns the department (its own work record is already above)
  for (const m of modules ?? []) {
    // the work record is above; complaint types have their own card beside this one
    if (m.key === "work" || m.key === "patterns" || m.empty || !m.notes[0]) continue;
    items.push({ key: `m:${m.key}`, tone: m.stale ? "t-med" : "t-teal", icon: MODULE_ICON[m.key] ?? "doc", title: m.notes[0], sub: `${m.title} · ${m.source}`, run: () => openModule(m.key) });
  }
  return (
    <article className="card o-pri" style={style}>
      <div className="ch"><I n="target" /><h3>What needs you now <span>· {c.ov.periodInfo.label}{c.areaName ? ` · ${c.areaName}` : ""}</span></h3>
        {items.length > 0 && <span className="cnt-b">{items.length}</span>}</div>
      <div className="o-list">
        {items.length ? items.map((p) => (
          <button key={p.key} className="opri" onClick={p.run}>
            <span className={`bic ${p.tone}`}><I n={p.icon} /></span>
            <span style={{ minWidth: 0, flex: 1 }}><b>{p.title}</b><small>{p.sub}</small></span>
            <I n="chevr" className="opri-go" />
          </button>
        )) : <Empty>Nothing needs you right now: no new, returned, late or due grievances {P}.</Empty>}
        {modules == null && <div className="opri-load">Reading the department&apos;s data…</div>}
      </div>
    </article>
  );
}
