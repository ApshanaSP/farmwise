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
  ["open", "Unresolved"], ["awaiting", "Awaiting your verification"], ["critical", "Severe, not yet verified"],
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
    if (c.zone) p.set("zone", String(c.zone));
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

export function ExportBody({ c }: { c: Console }) {
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const q = () => {
    const p = new URLSearchParams({ period: c.period });
    if (c.zone) p.set("zone", String(c.zone));
    if (c.dept) p.set("dept", c.dept);
    return p;
  };
  const stem = `district-iq-${c.period}${c.zone ? "-zone" + c.zone : ""}${c.dept ? "-" + c.dept.toLowerCase() : ""}`;
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
      c.toast(`${j.count.toLocaleString("en-IN")} incidents exported to CSV.`);
    } catch {
      c.toast("CSV export failed.", "alert");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <p style={{ margin: "0 0 14px", color: "var(--text-2)", fontSize: 14 }}>
        Scope: <b>{c.periodLabel}</b> · <b>{c.zoneName ?? "District-wide"}</b>{c.deptName ? <> · <b>{c.deptName}</b></> : null}. Change the filters on the dashboard to change the report.
      </p>
      <div className="xopts">
        <div className="xopt main">
          <h4><span className="kpi-ic t-sev"><I n="doc" /></span>PDF report</h4>
          <p>A complete briefing to print or share, with every insight on the dashboard.</p>
          <ul>
            <li>Headline figures with change vs. the previous period, and key insights</li>
            <li>Charts: complaints by department, top zones, severity mix and the trend</li>
            <li>Ongoing incidents grouped by priority, each with its reasons</li>
            <li>Open complaints, officer actions awaiting your verification, and news sent to departments</li>
            <li>Rainfall, air quality and reservoir storage with trends</li>
          </ul>
          <button className="btn" onClick={pdf} disabled={!!busy}>{busy === "pdf" ? <><I n="refresh" className="spin" />Building report…</> : <><I n="download" />Download PDF report</>}</button>
        </div>
        <div className="xopt">
          <h4><span className="kpi-ic t-info"><I n="chart" /></span>CSV data</h4>
          <p>Every incident in scope as a spreadsheet: ID, event, zone, location, department, severity, status, complaints and time.</p>
          <button className="btn plain" onClick={csv} disabled={!!busy}>{busy === "csv" ? "Preparing…" : <><I n="download" />Download CSV</>}</button>
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

// ------------------------------------------------------------ assistant --

const ASKQ = ["Which zone needs attention now?", "Summarize this period", "What is waiting for my verification?", "Which department is slowest?"];

/** Rule-based answers over the same data the console shows; no model is called. */
export function answer(text: string, d: OverviewData | null, c: Console): ReactNode {
  if (!d) return "Open the overview first; I answer from its data.";
  const t = text.toLowerCase();
  const where = c.zoneName ? ` in ${c.zoneName}` : "";
  if (/zone|area|attention|where/.test(t)) {
    const z = [...d.zoneTable].sort((a, b) => b.severe * 3 + b.complaints - (a.severe * 3 + a.complaints))[0];
    if (!z) return "No incidents in this period.";
    const top = d.severity.rows[0];
    return (<><b>{z.name}</b> has the heaviest load: {z.open} open incidents, {z.complaints} open citizen complaints and {z.severe} severe events ({c.periodLabel.toLowerCase()}).
      {top && <> Top open item: {fullTitle(top)} ({top.sev}).</>} <button onClick={() => c.setZone(z.zone)}>Filter dashboard to {z.name} ›</button></>);
  }
  if (/verif|waiting|task/.test(t)) {
    return d.tasks.count ? (<>{d.tasks.count} complaints{where} have officer action waiting for your verification. First:{" "}
      {d.tasks.rows.slice(0, 3).map((i, k) => (<span key={i.id}>{k ? ", " : ""}<button onClick={() => c.openInc(i.id)}>{i.type} – {i.zone_name}</button></span>))}.</>)
      : "Nothing is waiting for your verification.";
  }
  if (/slow|department|dept/.test(t)) {
    const b = d.backlog;
    return b ? (<><b>{b.name}</b> has the oldest open backlog{where}: {Math.round(b.hours / 24)} days per open incident on average ({b.n} open). <button onClick={() => c.setDept(b.code)}>Show {b.name} ›</button></>)
      : "No department has enough open incidents to compare.";
  }
  const k = d.kpi.cur;
  const topD = d.bottom.byDept[0];
  return (<>{d.periodInfo.label}, {(c.zoneName ?? "district-wide").toLowerCase()}: {k.severe} severe events, {k.ongoing} incidents still open with {k.complaints} open citizen complaints, and {k.resolved} resolved.
    {topD && <> {topD.l} receives the most citizen complaints ({topD.v}).</>}</>);
}

export function Ask({ c, d }: { c: Console; d: OverviewData | null }) {
  const [text, setText] = useState("");
  const send = (q: string) => {
    if (!q.trim()) return;
    c.setChat((m) => [...m, { r: "q", h: q }, { r: "a", h: answer(q, d, c) }]);
    setText("");
  };
  useEffect(() => {
    const b = document.getElementById("askB");
    if (b) b.scrollTop = b.scrollHeight;
  }, [c.chat]);
  return (
    <div className="ask" role="dialog" aria-label="Assistant">
      <div className="ask-h">
        <span className="kpi-ic" style={{ width: 34, height: 34, background: "rgba(255,255,255,.18)", color: "#fff" }}><I n="spark" /></span>
        <div><b>Ask District IQ</b><small>Answers from the dashboard&apos;s live data</small></div>
        <button className="xbtn" style={{ width: 30, height: 30 }} onClick={() => c.setAsk(false)} aria-label="Close"><I n="x" /></button>
      </div>
      <div className="ask-b" id="askB">
        {c.chat.length ? c.chat.map((m, k) => <div key={k} className={`msg ${m.r}`}>{m.h}</div>)
          : <div className="msg a">Ask about zones, departments or pending work. I read the same data you see, for the current period and filters.</div>}
      </div>
      <div className="ask-chips">{ASKQ.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}</div>
      <form className="ask-f" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a question" autoComplete="off" aria-label="Question" autoFocus />
        <button className="btn sm" aria-label="Send"><I n="send" /></button>
      </form>
    </div>
  );
}
