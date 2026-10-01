"use client";

import { useEffect, useState, type ReactNode } from "react";
import { I } from "@/components/collector/app/icons";
import { Empty, SevChip, fmtShort, type Row } from "@/components/collector/app/lib";
import { StageChip } from "./Cards";
import type { Ctx, ListFlag } from "./OfficerApp";

export function Modal({ title, children, onClose, narrow }: { title: string; children: ReactNode; onClose: () => void; narrow?: boolean }) {
  return (
    <div className={`modal${narrow ? " narrow" : ""}`} role="dialog" aria-label={title}>
      <div className="modal-h"><h2>{title}</h2><button className="xbtn" onClick={onClose} aria-label="Close"><I n="x" /></button></div>
      <div className="modal-b">{children}</div>
    </div>
  );
}

/**
 * Every grievance of one type (from "Complaints by Type"), or of one of the Collector's snapshot
 * tiles (severe or high and open; past deadline and open), or due within 24 hours, in the period and area,
 * with a keyword filter and pages.
 */
export function ListBody({ c, cat, flag, sev, tab = "all" }: { c: Ctx; cat: string | null; flag?: ListFlag; sev?: string | null; tab?: string }) {
  const per = 12;
  const [page, setPage] = useState(0);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { setQ(text.trim()); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams(c.scopeQs);
    p.set("tab", tab); p.set("per", String(per)); p.set("page", String(page));
    if (cat) p.set("cat", cat);
    if (flag) p.set("flag", flag);
    if (sev) p.set("sev", sev);
    if (q.length >= 2) p.set("q", q);
    setErr(null);
    fetch(`/api/officer/grievances?${p}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load grievances."); if (live) setData(j); })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [page, q, cat, flag, sev, tab, c.scopeQs, c.reloadKey]);
  const pages = data ? Math.max(1, Math.ceil(data.total / per)) : 1;
  return (
    <>
      <div className="filters">
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by keyword, street or ID" aria-label="Filter" autoFocus />
      </div>
      <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 8 }}>
        {data ? `${data.total.toLocaleString("en-IN")} grievances` : "Loading…"} · {c.ov.periodInfo.label} · {c.areaName ?? "all areas"}
      </div>
      {err ? <div className="o-state err">{err}</div> : (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>ID</th><th>Grievance</th><th>Stage</th><th>Severity</th><th>Location</th><th>Complaints</th><th>Reported</th></tr></thead>
            <tbody>
              {data?.rows.length ? data.rows.map((r) => (
                <tr key={r.id} onClick={() => c.openGrievance(r.id)}>
                  <td className="dim num">{r.id}</td><td className="ev">{r.type}</td><td><StageChip r={r} /></td><td><SevChip s={r.sev} /></td>
                  <td>{r.loc ?? "—"} <span className="dim">· {r.zone_name ?? "Chennai"}</span></td><td className="num">{r.complaints}</td><td className="dim num">{fmtShort(r.t)}</td>
                </tr>
              )) : data ? <tr><td colSpan={7}><Empty>No grievances match.</Empty></td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      <div className="pgr" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <span>Page {page + 1} of {pages}</span>
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous"><I n="chevl" /></button>
        <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages - 1} aria-label="Next"><I n="chevr" /></button>
      </div>
    </>
  );
}
