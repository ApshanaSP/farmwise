"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { IncidentDetail, Overview as OverviewData } from "@/lib/collector/intel";
import { I } from "./icons";
import { Actions, Evidence, Timeline } from "./Detail";
import { NewsItem } from "./Overview";
import { Empty, SEVS, SevChip, StChip, deptIcon, fmtShort, fullTitle, rel, shortDept, type Row } from "./lib";
import type { Console, ListPreset } from "./CollectorApp";

// ------------------------------------------------------------- drawer --

export function Drawer({ id, mode, c }: { id: string; mode?: "news"; c: Console }) {
  const [data, setData] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "reject" | "note">(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    setError(null);
    fetch(`/api/collector/incidents/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not load the incident.");
        if (live) setData(j);
      })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id, c.reloadKey]);

  const i = data?.incident;
  const now = c.now;
  const head = (
    <button className="xbtn" onClick={c.closeAll} aria-label="Close"><I n="x" /></button>
  );

  if (!data || !i || i.id !== id) {
    return (
      <aside className="drawer" role="dialog" aria-label="Incident details">
        <div className="drawer-h">{head}<h2>{error ? "Incident" : "Loading…"}</h2></div>
        <div className="drawer-b">{error ? <div className="ferr">{error}</div> : <div className="empty">Loading the incident…</div>}</div>
      </aside>
    );
  }

  if (mode === "news") {
    return (
      <aside className="drawer" role="dialog" aria-label="News details">
        <div className="drawer-h">{head}
          <div className="meta-row"><span className="chip chip-src"><I n="news" />News report</span><span>{fmtShort(data.documents[0]?.t ?? i.t)}</span></div>
          <h2>{fullTitle(i)}</h2>
          <div className="meta-row"><I n="pin" />{i.loc ? `${i.loc}, ` : ""}{i.zone_name ?? "Chennai"} · {i.dept_name ?? i.dept}</div>
        </div>
        <div className="drawer-b">
          {i.summary && <p style={{ margin: 0, color: "var(--text-2)" }}>{i.summary}</p>}
          <div className="dgrid">
            <div><small>Zone</small><b>{i.zone_name ?? "—"}</b></div>
            <div><small>Department concerned</small><b>{i.dept_name ?? i.dept}</b></div>
            <div><small>Outlets reporting</small><b className="num">{new Set(data.documents.map((x) => x.publisher)).size || i.outlets}</b></div>
            <div><small>First reported</small><b>{fmtShort(data.documents[0]?.t ?? i.t)}</b></div>
          </div>
          <div>
            <div className="sec-t">Coverage ({data.documents.length})</div>
            {data.documents.length ? data.documents.map((doc) => (
              <div className="src" key={doc.doc_id}>
                <span className="sic t-high"><I n="news" /></span>
                <span style={{ minWidth: 0 }}>
                  <b>{doc.publisher}</b>
                  <small>{doc.lang === "ta" ? "Tamil" : "English"} · {fmtShort(doc.t)}</small>
                  {doc.url ? <a href={doc.url} target="_blank" rel="noreferrer" style={{ display: "block", color: "var(--accent)", fontSize: 12 }}>{doc.title} ↗</a>
                    : <span style={{ display: "block", color: "var(--text-2)", fontSize: 12 }}>{doc.title}</span>}
                </span>
              </div>
            )) : <div className="empty">No articles are linked to this incident.</div>}
          </div>
        </div>
        <div className="drawer-f">
          <button className="btn plain" onClick={() => c.openInc(i.id)}><I n="doc" />Full incident record</button>
          {i.dept && <button className="btn plain" onClick={() => c.filterDept(i)}><I n={deptIcon(i.dept)} />Show {shortDept(i.dept)} only</button>}
        </div>
      </aside>
    );
  }

  const open = Number(i.open) === 1;
  const verified = Number(i.verified) === 1;
  return (
    <aside className="drawer" role="dialog" aria-label="Incident details">
      <div className="drawer-h">{head}
        <div className="meta-row">
          <span className="num" style={{ color: "#fff" }}>{i.id}</span><SevChip s={i.sev} /><StChip s={i.status} />
          {verified ? <span className="chip sev-low"><I n="check" />Verified</span> : <span className="chip sev-medium">Awaiting verification</span>}
          {i.escalated ? <span className="chip sev-severe">Escalated</span> : null}
        </div>
        <h2>{fullTitle(i)}</h2>
        <div className="meta-row"><I n="pin" />{i.loc ? `${i.loc}, ` : ""}{i.zone_name ?? "Chennai"}{i.ward ? `, ward ${i.ward}` : ""} · {i.dept_name ?? i.dept}</div>
      </div>
      <div className="drawer-b">
        {(i.summary || i.attention_reason) && <p style={{ margin: 0, color: "var(--text-2)" }}>{i.summary || i.attention_reason}</p>}
        <div className="dgrid">
          <div><small>Reported</small><b>{fmtShort(i.t)}</b></div>
          <div><small>Assigned officer</small><b>{i.officer || i.dept_head || "—"}</b></div>
          <div><small>Linked complaints</small><b className="num">{i.complaints}</b></div>
          <div><small>{open ? "Open for" : "Closed"}</small><b>{open ? rel(i.t, now).replace(" ago", "") : i.closed_at ? fmtShort(i.closed_at) : i.status}</b></div>
          <div><small>Deadline</small><b style={{ color: Number(i.breached) && open ? "var(--sev)" : undefined }}>{i.sla_due ? fmtShort(i.sla_due) : "—"}</b></div>
          <div><small>Priority</small><b className="num">{Math.round(Number(i.priority) || 0)}</b></div>
        </div>
        {i.priority_reasons && (
          <div><div className="sec-t">Why it matters</div>
            <div className="meta-row" style={{ marginTop: 0 }}>
              {String(i.priority_reasons).split(/[;|]/).map((s: string) => s.trim()).filter(Boolean).slice(0, 6).map((s: string) => (
                <span key={s} className="chip chip-src">{s}</span>
              ))}
            </div>
          </div>
        )}
        <div><div className="sec-t">Timeline</div><Timeline steps={data.timeline} /></div>
        <div><div className="sec-t">Source evidence ({data.members.length})</div><Evidence members={data.members} /></div>
        {data.documents.length > 0 && (
          <div><div className="sec-t">News coverage ({data.documents.length})</div>
            {data.documents.slice(0, 5).map((d) => (
              <div key={d.doc_id} style={{ fontSize: 12.5, padding: "3px 0" }}>
                <b>{d.publisher}</b> · {d.url ? <a href={d.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{d.title}</a> : d.title}
              </div>
            ))}
          </div>
        )}
        <div><div className="sec-t">Action plan · click to update</div><Actions data={data} c={c} /></div>
        {ask && (
          <div>
            <div className="sec-t">{ask === "reject" ? "Reject: say why" : "Add a note"}</div>
            <textarea className="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus
              placeholder={ask === "reject" ? "e.g. Not a civic issue; duplicate of another incident" : "Visible in the incident history"} />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button className="btn sm" disabled={!note.trim()} onClick={async () => {
                if (await c.decide([i], ask, note.trim())) { setAsk(null); setNote(""); }
              }}>Save</button>
              <button className="btn sm plain" onClick={() => setAsk(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <div className="drawer-f">
        {verified ? <button className="btn done" disabled><I n="check" />Verified</button>
          : <button className="btn" onClick={() => c.verify([i])} disabled={c.busyIds.has(i.id)}><I n="check" />Verify</button>}
        {open ? (
          <>
            <button className="btn warn" onClick={() => c.decide([i], "escalate")} disabled={c.busyIds.has(i.id)}><I n="esc" />Escalate</button>
            <button className="btn plain" onClick={() => c.decide([i], "resolve")} disabled={c.busyIds.has(i.id)}><I n="checkc" />Mark resolved</button>
            <button className="btn plain" onClick={() => setAsk("reject")}><I n="x" />Reject</button>
          </>
        ) : (
          <button className="btn plain" onClick={() => c.decide([i], "reopen")}><I n="refresh" />Reopen</button>
        )}
        <button className="btn plain" onClick={() => setAsk("note")}><I n="chat" />Note</button>
        {i.dept && <button className="btn plain" onClick={() => c.filterDept(i)}><I n={deptIcon(i.dept)} />Show {shortDept(i.dept)} only</button>}
      </div>
    </aside>
  );
}

// -------------------------------------------------------------- modal --

export function Modal({ title, children, c }: { title: string; children: ReactNode; c: Console }) {
  return (
    <div className="modal" role="dialog" aria-label={title}>
      <div className="modal-h"><h2>{title}</h2><button className="xbtn" onClick={c.closeAll} aria-label="Close"><I n="x" /></button></div>
      <div className="modal-b">{children}</div>
    </div>
  );
}

const STATUS_OPTS: [string, string][] = [
  ["open", "Unresolved"], ["unverified", "Awaiting verification"], ["verified", "Officer-verified, open"],
  ["critical", "Critical, awaiting action"], ["Open", "Open"], ["Under review", "Under review"], ["Assigned", "Assigned"],
  ["In progress", "In progress"], ["Awaiting verification", "Awaiting officer sign-off"], ["Resolved", "Resolved"],
  ["Rejected", "Rejected"], ["Lapsed", "Lapsed"]
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
    for (const k of ["dept", "sev", "status", "q"] as const) if (f[k]) p.set(k, String(f[k]));
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
      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8 }}>
        {data ? `${data.total.toLocaleString("en-IN")} incidents · ${c.zoneName ?? "District-wide"} · citizen complaints linked: ${data.complaints.toLocaleString("en-IN")}` : "Loading…"}
      </div>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>ID</th><th>Event</th>{th("r", "Zone")}<th>Location</th>{th("d", "Department")}{th("sev", "Severity")}<th>Status</th>{th("c", "Complaints")}{th("t", "Reported")}</tr></thead>
          <tbody>
            {data?.rows.map((i) => (
              <tr key={i.id} onClick={() => c.openInc(i.id)}>
                <td className="dim num">{i.id}</td><td className="ev">{i.type}</td><td>{i.zone_name ?? "—"}</td>
                <td className="dim" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{i.loc ?? "—"}</td>
                <td>{i.dept_name ?? i.dept}</td><td><SevChip s={i.sev} /></td><td><StChip s={i.status} /></td>
                <td className="num">{i.complaints}</td><td className="num dim">{fmtShort(i.t)}</td>
              </tr>
            ))}
            {data && !data.rows.length && <tr><td colSpan={9}><div className="empty">No incidents match these filters.</div></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager" style={{ justifyContent: "flex-end", marginTop: 10 }}>
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
                <span className="hb-t" style={{ flex: 1 }}><span className="hb-b" style={{ width: `${(x.complaints / mx) * 100}%`, background: "linear-gradient(90deg,var(--b1),var(--b3))" }} /></span>
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
        <thead><tr><th>Department</th><th>Open incidents</th><th>Awaiting verification</th><th>Severe</th><th>Head</th></tr></thead>
        <tbody>
          {c.depts.map((d) => (
            <tr key={d.code} onClick={() => c.setDept(d.code)}>
              <td className="ev">{d.name}</td><td className="num">{d.open}</td><td className="num">{d.unverified}</td>
              <td className="num" style={{ color: "var(--sev)" }}>{d.severe}</td><td className="dim">{d.head}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FeedsBody({ d }: { d: OverviewData }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Source</th><th>Kind</th><th>Status</th><th>Newest record</th><th>Last success</th><th>Records</th></tr></thead>
        <tbody>
          {d.feeds.map((f) => (
            <tr key={f.source} style={{ cursor: "default" }}>
              <td className="ev">{f.source.toUpperCase()}</td><td className="dim">{f.kind}</td>
              <td><span className={`st ${f.status === "ok" ? "st-resolved" : "st-progress"}`}>{f.status}</span></td>
              <td className="num">{f.newest ? fmtShort(f.newest) : "—"}</td>
              <td className="num dim">{f.minutes_since_success != null ? `${f.minutes_since_success} min before the build` : "—"}</td>
              <td className="num">{Number(f.row_count).toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="demo-note" style={{ marginTop: 10 }}>Exported to the dashboard {d.exportedAt ? fmtShort(d.exportedAt) : "—"}. The pipeline refreshes the sources every 30 minutes.</p>
    </div>
  );
}

export function ContactBody({ dept, offices, office, c }: { dept: Row; offices: Row[]; office?: Row; c: Console }) {
  const list = office ? [office] : offices;
  return (
    <>
      <p style={{ marginTop: 0 }}><b>{dept.head}</b>, {dept.name} ({dept.org})<br /><span style={{ color: "var(--text-3)" }}>Escalation route: {dept.route}</span></p>
      {list.length > 0 && (
        <div className="tbl-wrap" style={{ marginBottom: 12 }}>
          <table>
            <thead><tr><th>Officer</th><th>Designation</th><th>Office</th><th>Phone</th><th>Email</th></tr></thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.office_id} style={{ cursor: "default" }}>
                  <td className="ev">{o.officer_name}</td><td>{o.designation}</td><td className="dim">{o.office_name}</td>
                  <td className="num">{o.phone ? <a href={`tel:${o.phone}`} className="lnk">{o.phone}</a> : "—"}</td>
                  <td>{o.email ? <a href={`mailto:${o.email}`} className="lnk">{o.email}</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ color: "var(--text-2)" }}>
        Calls go through the district control room. To keep a record, add a note to the incident you are following up.
      </p>
      <button className="btn" onClick={c.closeAll}>Done</button>
    </>
  );
}

export function ExportBody({ c }: { c: Console }) {
  const [data, setData] = useState<{ csv: string; count: number } | null>(null);
  useEffect(() => {
    const p = new URLSearchParams({ period: c.period });
    if (c.zone) p.set("zone", String(c.zone));
    if (c.dept) p.set("dept", c.dept);
    fetch(`/api/collector/export?${p}`).then((r) => r.json()).then(setData);
  }, [c.period, c.zone, c.dept]);
  if (!data) return <div className="empty">Preparing the export…</div>;
  const download = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + data.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `chennai-incidents-${c.period}${c.zone ? "-zone" + c.zone : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <p style={{ marginTop: 0, color: "var(--text-2)" }}>{data.count.toLocaleString("en-IN")} incidents · {c.periodLabel}, {c.zoneName ?? "District-wide"}{c.deptName ? ` · ${c.deptName}` : ""}.</p>
      <textarea readOnly value={data.csv} style={{ width: "100%", height: 280, font: "12px var(--dic-mono),monospace", border: "1px solid var(--line)", borderRadius: 10, padding: 10, background: "var(--surface-2)" }} />
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button className="btn" onClick={download}><I n="download" />Download CSV</button>
        <button className="btn plain" onClick={() => navigator.clipboard.writeText(data.csv).then(() => c.toast("CSV copied to clipboard."), () => c.toast("Copy failed; select the text and press Ctrl+C.", "alert"))}>
          <I n="copy" />Copy CSV
        </button>
      </div>
    </>
  );
}

export function NewsAllBody({ d, c }: { d: OverviewData; c: Console }) {
  return d.news.length ? <>{d.news.map((i) => <NewsItem key={i.id} i={i} now={d.now} c={c} />)}</> : <Empty>No news reports in this period.</Empty>;
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
    const top = d.priority[0];
    return (<><b>{z.name}</b> has the heaviest load: {z.open} open incidents, {z.complaints} open citizen complaints and {z.severe} severe events ({c.periodLabel.toLowerCase()}).
      {top && <> Top open item district-wide: {fullTitle(top)} ({top.sev}).</>} <button onClick={() => c.setZone(z.zone)}>Filter dashboard to {z.name} ›</button></>);
  }
  if (/verif|waiting|task/.test(t)) {
    return d.tasks.count ? (<>{d.tasks.count} incidents from the last 14 days are waiting for verification{where}. Most urgent:{" "}
      {d.tasks.rows.slice(0, 3).map((i, k) => (<span key={i.id}>{k ? ", " : ""}<button onClick={() => c.openInc(i.id)}>{i.type} – {i.zone_name}</button></span>))}.</>)
      : "Nothing is waiting for verification.";
  }
  if (/slow|department|dept/.test(t)) {
    const b = d.backlog;
    return b ? (<><b>{b.name}</b> has the oldest open backlog{where}: {Math.round(b.hours / 24)} days per open incident on average ({b.n} open). <button onClick={() => c.setDept(b.code)}>Open {b.name} ›</button></>)
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
        <div><b>Ask Chennai AI</b><small>Answers from the dashboard&apos;s live data</small></div>
        <button className="kebab" style={{ marginLeft: "auto" }} onClick={() => c.setAsk(false)} aria-label="Close"><I n="x" /></button>
      </div>
      <div className="ask-b" id="askB">
        {c.chat.length ? c.chat.map((m, k) => <div key={k} className={`msg ${m.r}`}>{m.h}</div>)
          : <div className="msg a">Ask about zones, departments or pending work. I read the same data you see, for the current period and zone filter.</div>}
      </div>
      <div className="ask-chips">{ASKQ.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}</div>
      <form className="ask-f" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a question" autoComplete="off" aria-label="Question" autoFocus />
        <button className="btn sm" aria-label="Send"><I n="send" /></button>
      </form>
    </div>
  );
}
