"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Overview as OverviewData } from "@/lib/collector/intel";
import { I } from "./icons";
import { OfficerCard } from "./Overview";
import { Empty, SEVS, SevChip, Sources, StChip, fmtShort, fullTitle, rel, type Row } from "./lib";
import type { Console, ListPreset } from "./CollectorApp";

// -------------------------------------------------------------- modal --

export function Modal({ title, children, c, narrow, wide }: { title: string; children: ReactNode; c: Console; narrow?: boolean; wide?: boolean }) {
  return (
    <div className={`modal${narrow ? " narrow" : ""}${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
      <div className="modal-h"><h2>{title}</h2><button className="xbtn" onClick={c.closeAll} aria-label="Close"><I n="x" /></button></div>
      <div className="modal-b">{children}</div>
    </div>
  );
}

const STATUS_OPTS: [string, string][] = [
  ["open", "Unresolved"], ["awaiting", "Awaiting your verification"], ["critical", "Severe, not yet checked"], ["overdue", "Open and past deadline"],
  ["Open", "Open"], ["Under review", "Under review"], ["Assigned", "Assigned"], ["In progress", "In progress"],
  ["Resolved", "Resolved"], ["Rejected", "Rejected"], ["Lapsed", "Lapsed"]
];

export function ListBody({ preset, c }: { preset: ListPreset; c: Console }) {
  const [f, setF] = useState({ dept: c.dept ?? "", sev: "", status: "", q: "", sort: "t", dir: -1, page: 0, scope: "period", ...preset });
  const [data, setData] = useState<{ rows: Row[]; total: number; complaints: number } | null>(null);
  const [text, setText] = useState(f.q);
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.q === text ? x : { ...x, q: text, page: 0 })), 250);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams({ period: c.period, sort: String(f.sort), dir: String(f.dir), page: String(f.page), scope: String(f.scope) });
    if (c.zone && !f.anyZone) p.set("zone", String(c.zone));
    for (const k of ["dept", "sev", "status", "q", "cat", "taluk"] as const) if ((f as Record<string, unknown>)[k]) p.set(k, String((f as Record<string, unknown>)[k]));
    fetch(`/api/collector/list?${p}`).then((r) => r.json()).then((j) => live && setData(j));
    return () => { live = false; };
  }, [f, c.period, c.zone, c.reloadKey]);

  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v, page: 0 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / 12)) : 1;
  const th = (k: string, l: string) => (
    <th className="sortable" onClick={() => setF((x) => ({ ...x, dir: x.sort === k ? -x.dir : -1, sort: k, page: 0 }))}>
      {l}{f.sort === k ? (f.dir < 0 ? " ↓" : " ↑") : ""}
    </th>
  );
  return (
    <>
      <div className="filters">
        <input type="search" placeholder="Filter by keyword, street, zone or ID" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filter" />
        <select className="sel" value={f.dept} onChange={(e) => set("dept", e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {c.depts.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
        <select className="sel" value={f.sev} onChange={(e) => set("sev", e.target.value)} aria-label="Severity">
          <option value="">All severities</option>{SEVS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="sel" value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="">All statuses</option>{STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="sel" value={f.scope} onChange={(e) => set("scope", e.target.value)} aria-label="Time range">
          <option value="period">{c.periodLabel}</option><option value="all">All 180 days</option>
        </select>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 8 }}>
        {data ? `${data.total.toLocaleString("en-IN")} incidents · ${c.zoneName ?? "District-wide"} · citizen complaints linked: ${data.complaints.toLocaleString("en-IN")}` : "Loading…"}
      </div>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Incident</th>{th("r", "Zone")}{th("d", "Department")}{th("sev", "Severity")}<th>Status</th><th>Reported by</th>{th("t", "Reported")}</tr></thead>
          <tbody>
            {data?.rows.map((i) => (
              <tr key={i.id} onClick={() => c.openInc(i.id)}>
                <td className="ev" style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis" }} title={fullTitle(i)}>{fullTitle(i)}</td>
                <td>{i.zone_name ?? "—"}</td>
                <td>{i.dept_name ?? i.dept}</td><td><SevChip s={i.sev} /></td><td><StChip s={i.status} /></td>
                <td><Sources i={i} /></td><td className="dim">{fmtShort(i.t)}</td>
              </tr>
            ))}
            {data && !data.rows.length && <tr><td colSpan={7}><div className="empty">No incidents match these filters.</div></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pgr" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <span>Page {f.page + 1} of {pages.toLocaleString("en-IN")}</span>
        <button onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))} disabled={f.page === 0} aria-label="Previous"><I n="chevl" /></button>
        <button onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))} disabled={f.page >= pages - 1} aria-label="Next"><I n="chevr" /></button>
      </div>
    </>
  );
}

export function ZonesBody({ d, c }: { d: OverviewData; c: Console }) {
  const rows = [...d.zoneTable].sort((a, b) => b.complaints - a.complaints);
  const mx = Math.max(1, ...rows.map((x) => x.complaints));
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Zone</th><th>Open incidents</th><th style={{ width: "40%" }}>Open complaints</th><th>Severe</th><th /></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.zone} onClick={() => { c.closeAll(); c.setZone(x.zone); }}>
              <td className="ev">{x.name}</td><td className="num">{x.open}</td>
              <td><span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="hb-t" style={{ flex: 1 }}><span className="hb-b" style={{ width: `${(x.complaints / mx) * 100}%`, background: "linear-gradient(90deg,#1560E8,#6699F5)" }} /></span>
                <b className="num">{x.complaints}</b></span></td>
              <td className="num" style={{ color: "var(--sev)" }}>{x.severe}</td><td><span className="lnk">Filter ›</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeptsBody({ c }: { c: Console }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Department</th><th>Open incidents</th><th>Awaiting your verification</th><th>Severe</th></tr></thead>
        <tbody>
          {c.depts.map((d) => (
            <tr key={d.code} onClick={() => c.setDept(d.code)}>
              <td className="ev">{d.name}</td><td className="num">{d.open}</td><td className="num">{d.unverified}</td>
              <td className="num" style={{ color: "var(--sev)" }}>{d.severe}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FEED_NAME: Record<string, string> = {
  grievance: "Grievance portal", police: "Police reports", pwd: "PWD records", hospital: "Hospitals",
  news: "News monitor", imd: "IMD weather", cpcb: "Air quality (CPCB)", cfm: "Flood monitoring"
};
export const feedName = (s: string) => FEED_NAME[s] ?? s;

export function FeedsBody({ d }: { d: OverviewData }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Source</th><th>Status</th><th>Newest record</th><th>Last success</th><th>Records</th></tr></thead>
        <tbody>
          {d.feeds.map((f) => (
            <tr key={f.source} style={{ cursor: "default" }}>
              <td className="ev">{feedName(f.source)}</td>
              <td><span className={`st ${f.status === "ok" ? "st-resolved" : "st-progress"}`}>{f.status === "ok" ? "Healthy" : f.status}</span></td>
              <td>{f.newest ? fmtShort(f.newest) : "—"}</td>
              <td className="dim">{f.minutes_since_success != null ? `${f.minutes_since_success} min before the build` : "—"}</td>
              <td className="num">{Number(f.row_count).toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 12, fontSize: 13, color: "var(--text-3)" }}>Exported to the dashboard {d.exportedAt ? fmtShort(d.exportedAt) : "—"}. The pipeline refreshes every source every 30 minutes.</p>
    </div>
  );
}

export function ContactBody({ dept, contacts }: { dept: Row; contacts: Row[] }) {
  const own = contacts.filter((x) => x.dept_code === dept.code);
  const zone = contacts.filter((x) => x.zone_no != null);
  return (
    <>
      <p style={{ margin: "0 0 12px", color: "var(--text-2)", fontSize: 14 }}>
        <b style={{ color: "var(--text)" }}>{dept.name}</b> ({dept.org}). Escalation route: {dept.route}.
      </p>
      {own.length || zone.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 10 }}>
          {own.map((o) => <OfficerCard key={o.contact_id} o={o} />)}
          {zone.map((o) => <OfficerCard key={o.contact_id} o={o} label="Zonal officer" />)}
        </div>
      ) : <Empty>This department is not on the GCC Who&apos;s who page. Head: {dept.head}.</Empty>}
      {(own[0] ?? zone[0]) && (
        <p style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 14 }}>
          Source: <a href={(own[0] ?? zone[0]).source_url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>Greater Chennai Corporation, Who&apos;s who</a>,
          retrieved {(own[0] ?? zone[0]).retrieved_on}. GCC 24-hour complaints cell: 1913.
        </p>
      )}
    </>
  );
}

const REPORT_PERIODS = [
  ["daily", "Daily", "last 24 hours"], ["weekly", "Weekly", "last 7 days"], ["monthly", "Monthly", "last 30 days"], ["quarterly", "Quarterly", "last 90 days"]
] as const;

export function ExportBody({ c }: { c: Console }) {
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  // the report has its own period, starting from the dashboard's
  const [period, setPeriod] = useState<string>(c.period);
  const word = REPORT_PERIODS.find((p) => p[0] === period)!;
  const q = () => {
    const p = new URLSearchParams({ period });
    if (c.zone) p.set("zone", String(c.zone));
    if (c.dept) p.set("dept", c.dept);
    if (c.cat) p.set("cat", c.cat);
    if (c.taluk) p.set("taluk", c.taluk);
    return p;
  };
  const stem = `district-iq-${period}${c.zone ? "-zone" + c.zone : ""}${c.dept ? "-" + c.dept.toLowerCase() : ""}`;
  const pdf = async () => {
    setBusy("pdf");
    try {
      const r = await fetch(`/api/collector/report?${q()}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not build the report.");
      const { buildReport } = await import("./reportPdf");
      await buildReport(data, { scope: c.zoneName ?? "District-wide", dept: c.deptName, file: `${stem}-report.pdf` });
      c.toast("PDF report downloaded.");
    } catch (e: any) {
      c.toast(e.message, "alert");
    } finally {
      setBusy(null);
    }
  };
  const csv = async () => {
    setBusy("csv");
    try {
      const j = await fetch(`/api/collector/export?${q()}`).then((r) => r.json());
      const url = URL.createObjectURL(new Blob(["﻿" + j.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stem}-incidents.csv`;
      a.click();
      URL.revokeObjectURL(url);
      c.toast(j.count ? `Action list exported: ${j.count.toLocaleString("en-IN")} items that need you.` : "Nothing needs you in this scope; the CSV has only its header.");
    } catch {
      c.toast("CSV export failed.", "alert");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="xperiod">
        <span>Report for</span>
        <div className="seg" role="tablist" aria-label="Report period">
          {REPORT_PERIODS.map(([k, w, hint]) => (
            <button key={k} role="tab" aria-selected={period === k} className={period === k ? "on" : ""} title={`Incidents reported in the ${hint}`}
              onClick={() => setPeriod(k)}>{w}</button>
          ))}
        </div>
        <small>{word[2]} · {c.zoneName ?? "whole district"}{c.talukName(c.taluk) ? ` · ${c.talukName(c.taluk)} taluk` : ""}{c.deptName ? ` · ${c.deptName}` : ""}</small>
      </div>
      <div className="xopts">
        <div className="xopt main">
          <h4><span className="kpi-ic t-sev"><I n="doc" /></span>{word[1]} report (PDF)</h4>
          <p>Two to three pages to read or print. Only what needs you; routine work is counted, not listed.</p>
          <ul>
            <li>Headline numbers and a few key points</li>
            <li>Incidents that need your attention, and why</li>
            <li>Closed work waiting for your check</li>
            <li>Where the workload is; what is only in the news</li>
            <li>Rain, air quality and reservoirs</li>
          </ul>
          <button className="btn" onClick={pdf} disabled={!!busy}>{busy === "pdf" ? <><I n="refresh" className="spin" />Building report…</> : <><I n="download" />Download {word[1].toLowerCase()} report</>}</button>
        </div>
        <div className="xopt">
          <h4><span className="kpi-ic t-info"><I n="chart" /></span>Action list (CSV)</h4>
          <p>A short spreadsheet of what to act on: incidents that need you, then closed work to check. One row each, with the reason. Not every incident.</p>
          <button className="btn plain" onClick={csv} disabled={!!busy}>{busy === "csv" ? "Preparing…" : <><I n="download" />Download action list</>}</button>
        </div>
      </div>
    </>
  );
}

export function NewsAllBody({ d, c }: { d: OverviewData; c: Console }) {
  if (!d.news.length) return <Empty>No news reports in this period.</Empty>;
  return (
    <div className="ngrid">
      {d.news.map((i) => (
        <button key={i.id} className="ncard" onClick={() => c.openInc(i.id)}>
          <div className="nout">{(i.outletNames?.length ? i.outletNames : ["News"]).map((n: string) => <span key={n}>{n}</span>)}</div>
          <h4>{fullTitle(i)}</h4>
          <div className="nmeta">
            <span>{i.zone_name ?? "Chennai"}</span><span>{i.dept_name ?? i.dept}</span><span>{rel(i.t, d.now)}</span><SevChip s={i.sev} />
          </div>
          <Sources i={i} />
          {i.assigned && <span className="routed" style={{ alignSelf: "flex-start" }}><I n="send" />Sent to {i.assigned.officer_name ? `${i.assigned.officer_name}, ` : ""}{i.assigned.officer_designation ?? i.dept_name}</span>}
        </button>
      ))}
    </div>
  );
}
