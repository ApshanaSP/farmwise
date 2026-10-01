"use client";

/*
 * The officer console's second page, "Work & insights": everything the officer acts on, and only the
 * insights that change what they do, on one screen.
 *   How is my department doing?      the work record as a strip of figures (click: the full record)
 *   What do I act on?                the grievance board, one tab per workflow stage
 *   What needs me now?               approvals, returned work, late and due-soon grievances, and the main
 *                                    finding of each data source that concerns the department
 *   What are people complaining of?  complaint types now against the previous period
 *   What else concerns us?           the store's sources for the department (weather, lakes, police
 *                                    records, hospitals ...), one row each, opening in full
 * Every figure comes from the district intelligence store (lib/officer/insights.ts, lib/officer/data.ts).
 */
import { I, type IconName } from "@/components/collector/app/icons";
import { Empty, fmtDate } from "@/components/collector/app/lib";
import type { InsightModule } from "@/lib/officer/insights";
import { FeedbackCard, GrievancesCard, PrioritiesCard } from "./Cards";
import { MODULE_ICON } from "./Insights";
import type { Ctx } from "./OfficerApp";

const KPI_ICON: IconName[] = ["doc", "checkc", "clock", "alert", "shield"];
const TONE_CLASS: Record<string, string> = { sev: "t-sev", high: "t-high", med: "t-med", low: "t-low", info: "t-info", violet: "t-violet" };
const num = (v: unknown) => Number(String(v ?? "").replace(/,/g, "")) || 0;

export function WorkPage({ c, modules, openModule }: { c: Ctx; modules: InsightModule[] | null; openModule: (key: string) => void }) {
  const work = modules?.find((m) => m.key === "work");
  const patterns = modules?.find((m) => m.key === "patterns");
  const sources = (modules ?? []).filter((m) => m.key !== "work" && m.key !== "patterns");
  const types = patterns?.tables[0]?.rows ?? [];
  const maxType = Math.max(1, ...types.map((r) => num(r[1])));
  const P = c.ov.periodInfo;
  return (
    <>
      <section className="kpis oikpis" style={{ gridTemplateColumns: "repeat(5,minmax(0,1fr))" }}>
        {work && !work.empty ? work.kpis.slice(0, 5).map((k, ix) => (
          <button key={k.label} className="kpi" style={{ "--i": ix } as React.CSSProperties} onClick={() => openModule("work")}
            title={`${k.label}: ${k.value}${k.sub ? ` (${k.sub})` : ""}. Click for the full work record.`}>
            <span className={`kpi-ic ${TONE_CLASS[k.tone ?? "info"] ?? "t-info"}`}><I n={KPI_ICON[ix] ?? "chart"} /></span>
            <span className="kpi-b">
              <span className="kpi-l">{k.label}</span>
              <span className="kpi-n" style={k.tone === "sev" ? { color: "var(--sev)" } : undefined}>{k.value}</span>
              {k.sub && <span className="kpi-d oi-sub">{k.sub}</span>}
            </span>
          </button>
        )) : Array.from({ length: 5 }, (_, k) => <div key={k} className="kpi o-skel-k" />)}
      </section>

      {/* with one data source or none, complaint types get most of the right column */}
      <section className="opw" style={sources.length <= 1 ? { gridTemplateRows: "minmax(0,1.6fr) minmax(0,1fr)" } : undefined}>
        <GrievancesCard c={c} style={{ "--i": 5 } as React.CSSProperties} />
        <PrioritiesCard c={c} modules={modules} openModule={openModule} style={{ "--i": 6 } as React.CSSProperties} />

        <article className="card oi-types" style={{ "--i": 7 } as React.CSSProperties}>
          <div className="ch"><I n="chart" /><h3>Complaint types <span>· against the {P.prev}</span></h3>
            {patterns && <button className="more" onClick={() => openModule("patterns")}>Details<I n="right" /></button>}</div>
          <div className="fitlist">
            {types.length ? types.map((r) => {
              const ch = String(r[3]);
              const up = ch.startsWith("+") || ch === "new", down = ch.startsWith("−");
              return (
                <div key={String(r[0])} className="oi-type" title={`${r[0]}: ${r[1]} this period, ${r[2]} before (${ch})`}>
                  <span className="oi-tl">{r[0]}</span>
                  <span className="oi-tn">{r[1]}<small> was {r[2]}</small></span>
                  <span className={`oi-ch${up ? " up" : down ? " down" : ""}`}>{ch}</span>
                  <span className="oi-bar"><i style={{ width: `${(num(r[1]) / maxType) * 100}%` }} /></span>
                </div>
              );
            }) : <Empty>{modules ? "No grievances in this period." : "Reading the department's data…"}</Empty>}
          </div>
        </article>

        {sources.length ? (
          <article className="card oi-src" style={{ "--i": 8 } as React.CSSProperties}>
            <div className="ch"><I n="layers" /><h3>{c.dept.short} data in the district</h3></div>
            <div className="fitlist">
              {sources.map((m) => (
                <button key={m.key} className="oi-s" onClick={() => openModule(m.key)} title={`${m.source}. Click for every chart and table.`}>
                  <span className="oi-sh"><I n={MODULE_ICON[m.key] ?? "doc"} />
                    <span className="oi-st"><b>{m.title}</b>
                      <small className={m.stale ? "old" : ""}>{m.stale && m.asOf ? `Data up to ${fmtDate(m.asOf)}` : m.area === "district" ? "District-wide" : c.areaName ?? "Your area"}</small></span>
                  </span>
                  {m.empty ? <small className="oi-empty">No data</small> : (
                    <span className="oi-sk">
                      {m.kpis.slice(0, 2).map((k) => <span key={k.label} className={k.tone ? `k-${k.tone}` : ""} title={`${k.label}: ${k.value}${k.sub ? ` (${k.sub})` : ""}`}><small>{k.label}</small><b>{k.value}</b></span>)}
                    </span>
                  )}
                  <I n="chevr" />
                </button>
              ))}
            </div>
          </article>
        ) : (
          // no other district data concerns this department: the Collector's decisions on its reports instead
          <FeedbackCard c={c} style={{ "--i": 8 } as React.CSSProperties} />
        )}
      </section>
    </>
  );
}
