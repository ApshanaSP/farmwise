"use client";

import { useEffect, useState } from "react";
import { I } from "./icons";
import { Empty, fmtShort, type Row } from "./lib";
import type { Console } from "./CollectorApp";

export interface Layout {
  pages: { briefing: boolean; trends: boolean; environment: boolean };
  panels: { map: boolean; snapshot: boolean; brief: boolean; severity: boolean; tasks: boolean };
  kpis: string[];
}
export const DEFAULT_LAYOUT: Layout = {
  pages: { briefing: true, trends: true, environment: true },
  panels: { map: true, snapshot: true, brief: true, severity: true, tasks: true },
  kpis: ["severe", "complaints", "ongoing", "resolved"]
};
export const KPI_LABELS: Record<string, string> = {
  severe: "Severe events", complaints: "Open complaints", ongoing: "Ongoing incidents", resolved: "Resolved"
};

/** Save the current view (filters, layout and a frozen briefing) and reopen saved versions. */
export function WorkspaceBody({ c }: { c: Console }) {
  const [list, setList] = useState<{ name: string; versions: Row[] }[] | null>(null);
  const [name, setName] = useState(c.workspaceName ?? "Collector's Daily Briefing");
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/collector/workspaces").then((r) => r.json()).then((j) => setList(j.workspaces ?? [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setBusy(true);
    try {
      const v = await c.saveWorkspace(name.trim());
      if (v) load();
    } finally { setBusy(false); }
  };
  return (
    <>
      <div className="wsave">
        <label>Save the current view as<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></label>
        <button className="btn" disabled={busy || name.trim().length < 2} onClick={save}><I n="layers" />{busy ? "Saving…" : "Save new version"}</button>
      </div>
      <p className="sub">A version stores the period, zone, department, category and taluk filters, your dashboard layout, and a frozen copy of the
        briefing as it reads right now, so you can reopen last week&apos;s version exactly as it was.</p>
      {!list ? <div className="empty">Loading…</div> : list.length ? list.map((w) => (
        <div key={w.name} className="wlist">
          <h4>{w.name}</h4>
          <div className="wv">
            {w.versions.map((v) => {
              const f = v.filters ?? {};
              return (
                <button key={v.id} className={`wv-i${v.is_current ? " cur" : ""}`} onClick={() => c.openSavedWorkspace(v.id)}>
                  <b>v{v.version}{v.is_current ? " · latest" : ""}</b>
                  <span>{fmtShort(v.created_at)}</span>
                  <small>{[f.period, f.zoneName, f.deptName, f.catLabel, f.talukName].filter(Boolean).join(" · ") || "District-wide"}</small>
                </button>
              );
            })}
          </div>
        </div>
      )) : <Empty>No saved workspaces yet.</Empty>}
    </>
  );
}

/** Choose what the dashboard shows. Saved in this browser and with every workspace version. */
export function CustomizeBody({ c }: { c: Console }) {
  const [l, setL] = useState<Layout>(c.layout);
  const panelCount = Object.values(l.panels).filter(Boolean).length;
  const setPanel = (k: keyof Layout["panels"], v: boolean) => setL((x) => ({ ...x, panels: { ...x.panels, [k]: v } }));
  const setPage = (k: keyof Layout["pages"], v: boolean) => setL((x) => ({ ...x, pages: { ...x.pages, [k]: v } }));
  const toggleKpi = (k: string) => setL((x) => ({ ...x, kpis: x.kpis.includes(k) ? x.kpis.filter((y) => y !== k) : [...x.kpis, k] }));
  return (
    <div className="cust">
      <section>
        <h4>Pages</h4>
        <label className="chk"><input type="checkbox" checked disabled />Overview</label>
        {([["briefing", "Briefing: written briefing, department follow-ups, news-only incidents"], ["trends", "Trends: categories over time, taluks, spikes, hotspots"],
          ["environment", "Environment & markets: rain, air, reservoirs, mandi prices by Chennai market, developing stories"]] as const).map(([k, t]) => (
          <label key={k} className="chk"><input type="checkbox" checked={l.pages[k]} onChange={(e) => setPage(k, e.target.checked)} />{t}</label>
        ))}
      </section>
      <section>
        <h4>Overview panels</h4>
        {([["map", "Satellite map"], ["snapshot", "District snapshot"], ["brief", "Today's briefing (news)"], ["severity", "Severity-based incidents"], ["tasks", "My tasks"]] as const).map(([k, t]) => (
          <label key={k} className="chk"><input type="checkbox" checked={l.panels[k]} disabled={l.panels[k] && panelCount === 1} onChange={(e) => setPanel(k, e.target.checked)} />{t}</label>
        ))}
        <h4 style={{ marginTop: 14 }}>Headline cards</h4>
        {Object.entries(KPI_LABELS).map(([k, t]) => (
          <label key={k} className="chk"><input type="checkbox" checked={l.kpis.includes(k)} onChange={() => toggleKpi(k)} />{t}</label>
        ))}
      </section>
      <div className="cust-f">
        <button className="btn plain" onClick={() => setL(DEFAULT_LAYOUT)}>Reset to default</button>
        <button className="btn" onClick={() => { c.setLayout(l); c.closeAll(); c.toast("Dashboard layout saved."); }}><I n="check" />Apply</button>
      </div>
    </div>
  );
}
