"use client";

import { useEffect, useState } from "react";
import type { Department as DeptData, IncidentDetail } from "@/lib/collector/intel";
import type { MapShapes } from "@/lib/collector/geo";
import { I } from "./icons";
import MapSvg, { MapScale } from "./MapSvg";
import { Empty, SEV_COL, SEVS, SevChip, SOURCE_KIND, StChip, deptIcon, fmtDate, fmtShort, fullTitle, rel, sevTone, shortDept, type Row } from "./lib";
import { DeptSelect, Kpi } from "./Overview";
import type { Console } from "./CollectorApp";

export default function Department({ d, shapes, c }: { d: DeptData; shapes: MapShapes; c: Console }) {
  const P = d.periodInfo;
  const dept = d.dept;
  const zone = d.zone ? d.zoneOpen.find((z) => z.zone === d.zone) : null;
  const short = shortDept(dept.code);
  const pp = typeof window !== "undefined" && window.innerHeight / (c.zoom || 1) > 940 ? 8 : 6;
  const list = d.list;
  const pages = Math.max(1, Math.ceil(list.length / pp));
  const page = Math.min(c.page, pages - 1);
  const rows = list.slice(page * pp, page * pp + pp);
  // An incident opened from elsewhere ("Open in department") stays selected even outside this period's list.
  const sel = list.find((i) => i.id === c.dsel) ?? (c.dsel && c.dsel.startsWith("INC-") ? { id: c.dsel } : list[0]) ?? null;
  const zoneCounts = Object.fromEntries(d.zoneOpen.map((z) => [z.zone, z.open]));
  const initials = (s: string) => s.split(/[\s()]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  let ix = 0;
  const iv = () => ({ "--i": ix++ }) as React.CSSProperties;

  return (
    <>
      <section className="hero" style={iv()}>
        <span className="hero-ic"><I n={deptIcon(dept.code)} /></span>
        <div>
          <div className="eyebrow">
            <button onClick={() => c.go("overview")}>Overview</button>›<span>Departments</span>›<span style={{ color: "#fff" }}>{dept.name}</span>
          </div>
          <h1>{dept.name} <span className="lt">| Department Intelligence</span></h1>
        </div>
        {zone && (
          <span className="fchip"><I n="pin" />Zone: {zone.name}
            <button className="x" onClick={() => c.setZone(null)} aria-label="Clear zone"><I n="x" /></button>
          </span>
        )}
        <DeptSelect c={c} />
        <span className="hero-sp" />
        <div className="hero-head">
          <span className="avatar">{initials(dept.head ?? dept.name)}</span>
          <div>
            <b>{dept.head && dept.head !== "-" ? dept.head : dept.name}</b>
            <span>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#3FE39A", marginRight: 5 }} />
              {dept.org} · {String(dept.route ?? "").split("→").length} level escalation
            </span>
          </div>
          <button className="btn-w" onClick={() => c.openContact(dept, d.offices)}><I n="phone" />Contact</button>
        </div>
      </section>

      <section className="kpis">
        <Kpi k="open" icon="cone" tone="t-info" label="Open Incidents" tag={P.label} v={d.kpi.cur.open} p={d.kpi.prev.open} goodDown
          series={d.kpi.series.open} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ status: "open" }, "Open incidents")} />
        <Kpi k="verified" icon="doc" tone="t-violet" label="Officer-Verified" tag={P.label} v={d.kpi.cur.verified} p={d.kpi.prev.verified}
          series={d.kpi.series.verified} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ status: "verified" }, "Officer-verified, still open")} />
        <Kpi k="severe" icon="alert" tone="t-sev" label="Severe Issues" tag={P.label} v={d.kpi.cur.severe} p={d.kpi.prev.severe} goodDown
          series={d.kpi.series.severe} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ sev: "Severe" }, "Severe issues")} />
        <Kpi k="resolved" icon="checkc" tone="t-low" label={`Resolved This ${P.unit}`} tag={short} v={d.kpi.cur.resolved} p={d.kpi.prev.resolved}
          series={d.kpi.series.resolved} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ status: "Resolved" }, "Resolved incidents")} />
      </section>

      <section className="dp-grid">
        <article className="card g-map" style={iv()}>
          <div className="ch"><I n="map" /><h3>{short} Incidents Map</h3></div>
          <div className="cb map-cb">
            <div className="map-wrap">
              <MapSvg shapes={shapes} zoneCounts={zoneCounts} pins={d.pins} zone={d.zone} mode="dept"
                onZone={(z) => c.setZone(z)} onPin={(id) => c.setDsel(id)} onTip={c.tip}
                zoneTip={(z) => {
                  const r = d.zoneOpen.find((x) => x.zone === z);
                  return `<b>${r?.name ?? "Zone " + z}</b>${r?.open ?? 0} open ${short} incidents<br><span style="opacity:.7">Click to filter to this zone</span>`;
                }} />
              <div className="map-leg">
                {SEVS.map((s) => (
                  <span key={s}><i style={{ background: SEV_COL[s] }} />{s} ({(d.sevCounts[s] ?? 0).toLocaleString("en-IN")})</span>
                ))}
              </div>
              <MapScale />
              <div className="map-tools">
                {zone && <button onClick={() => c.setZone(null)} title="Show whole district"><I n="expand" /></button>}
              </div>
            </div>
          </div>
        </article>

        <article className="card g-tbl" style={iv()}>
          <div className="ch"><I n="doc" /><h3>{short} Incidents <span>· source-linked list</span></h3>
            <span className="pager" style={{ marginLeft: "auto" }}>
              <span>{list.length ? page * pp + 1 : 0}–{Math.min(list.length, page * pp + pp)} of {list.length}{list.length >= 400 ? "+" : ""}</span>
              <button onClick={() => c.setPage(page - 1)} disabled={page === 0} aria-label="Previous page"><I n="chevl" /></button>
              <button onClick={() => c.setPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page"><I n="chevr" /></button>
            </span>
            <button className="more" onClick={() => c.openList({}, "All incidents")}>View all<I n="right" /></button>
          </div>
          <div className="cb">
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Incident</th><th>Location</th><th>Reported</th><th>Severity</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id} className={sel?.id === i.id ? "on" : ""} onClick={() => c.setDsel(i.id)}>
                      <td className="ev">{i.type} <span className="chip chip-src">{i.source_count} src</span></td>
                      <td>{i.loc ?? "—"} <span className="dim">· {i.zone_name ?? "?"}</span></td>
                      <td className="num dim">{rel(i.t, d.now)}</td>
                      <td><SevChip s={i.sev} /></td>
                      <td><StChip s={i.status} /></td>
                      <td><button className="vbtn" onClick={(e) => { e.stopPropagation(); c.openInc(i.id); }}>Details</button></td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={6}><div className="empty">No incidents for {dept.name} in this period.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </article>

        <article className="card g-q" style={iv()}>
          <div className="ch">
            <div className="tabs" style={{ marginLeft: 0 }}>
              <button className={c.qtab === "officers" ? "on" : ""} onClick={() => c.setQtab("officers")}>Officers</button>
              <button className={c.qtab === "queue" ? "on" : ""} onClick={() => c.setQtab("queue")}>Verify ({d.queue.count})</button>
              <button className={c.qtab === "news" ? "on" : ""} onClick={() => c.setQtab("news")}>Open issues</button>
            </div>
            {c.qtab !== "officers" && (
              <button className="more" onClick={() => c.qtab === "queue"
                ? c.openList({ status: "unverified", scope: "all", sort: "sev", dir: 1 }, "Awaiting verification")
                : c.openList({ status: "open" }, "Open incidents")}>All<I n="right" /></button>
            )}
          </div>
          <div className="cb">
            {c.qtab === "officers" ? (
              <>
                <div className="off-head">
                  <span className="avatar" style={{ width: 38, height: 38, borderRadius: 10, flex: "none" }}>{initials(dept.head ?? dept.name)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{dept.head}</b><small>Head of department · {dept.org}</small><small>Escalation: {dept.route}</small>
                  </span>
                  <button className="vbtn" onClick={() => c.openContact(dept, d.offices)} aria-label="Contact"><I n="phone" /></button>
                </div>
                {d.offices.length ? (
                  <>
                    <div className="sec-t" style={{ margin: "8px 0 2px" }}>Offices</div>
                    {d.offices.map((o) => (
                      <div className="task" key={o.office_id}>
                        <span className="avatar" style={{ width: 30, height: 30, fontSize: 10.5, flex: "none" }}>{initials(o.officer_name ?? o.office_name)}</span>
                        <div className="tb"><b>{o.officer_name}</b><span className="ln"><I n="gov" />{o.designation} · {o.office_name}</span></div>
                        <button className="vbtn" onClick={() => c.openContact(dept, d.offices, o)}>Contact</button>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    <div className="sec-t" style={{ margin: "8px 0 2px" }}>Open {short} incidents by zone</div>
                    {d.zoneOpen.map((z) => (
                      <div className="task" key={z.zone}>
                        <span className="avatar" style={{ width: 30, height: 30, fontSize: 10.5, flex: "none" }}>{String(z.zone).padStart(2, "0")}</span>
                        <div className="tb" onClick={() => c.setZone(z.zone)}><b>{z.name}</b><span className="ln"><I n="pin" />{z.open} open</span></div>
                        <button className="vbtn" onClick={() => c.setZone(z.zone)}>Filter</button>
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : c.qtab === "queue" ? (
              <>
                {c.qsel.size > 0 && (
                  <div className="bulk">{c.qsel.size} selected
                    <button className="btn sm" onClick={() => c.verify(d.queue.rows.filter((i) => c.qsel.has(i.id)))}>Verify selected</button>
                  </div>
                )}
                {d.queue.rows.length ? d.queue.rows.map((i) => (
                  <div className="task" key={i.id}>
                    <button className={`cbx ${c.qsel.has(i.id) ? "on" : ""}`} onClick={() => c.toggleQsel(i.id)} aria-label="Select"
                      aria-pressed={c.qsel.has(i.id)}>{c.qsel.has(i.id) ? <I n="check" /> : null}</button>
                    <div className="tb" onClick={() => c.openInc(i.id)}>
                      <b>{fullTitle(i)}</b>
                      <span className="ln">{String(i.sources).split("|").map((s: string) => SOURCE_KIND[s]?.k ?? s).join(", ")} · {rel(i.t, d.now)}</span>
                      {Number(i.complaints) > 0 && <span className="ln" style={{ color: "var(--accent)" }}><I n="chat" />{i.complaints} citizen complaint{i.complaints > 1 ? "s" : ""}</span>}
                    </div>
                    <div className="ta"><button className="btn sm" onClick={() => c.verify([i])} disabled={c.busyIds.has(i.id)}>Verify</button></div>
                  </div>
                )) : <Empty>Queue is clear.</Empty>}
              </>
            ) : d.news.length ? d.news.map((i) => (
              <button className="brief" key={i.id} onClick={() => c.setDsel(i.id)}>
                <span className={`bic ${sevTone(i.sev)}`}><I n={Number(i.outlets) > 0 ? "news" : deptIcon(i.dept)} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{fullTitle(i)}</b>
                  <span className="loc">{i.zone_name ?? "Chennai"} · {rel(i.t, d.now)}</span>
                  {i.summary && <p>{i.summary}</p>}
                </span>
              </button>
            )) : <Empty>No open incidents.</Empty>}
          </div>
        </article>

        {sel ? <DeptDetail id={sel.id} c={c} /> : (<><div className="card g-tl" /><div className="card g-src" /><div className="card g-act" /></>)}
        <TrendCard d={d} c={c} iv={iv} />
      </section>
    </>
  );
}

/** Timeline, source evidence and action list for the selected incident. */
function DeptDetail({ id, c }: { id: string; c: Console }) {
  const [data, setData] = useState<IncidentDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`/api/collector/incidents/${encodeURIComponent(id)}`).then((r) => r.json()).then((j) => live && !j.error && setData(j));
    return () => { live = false; };
  }, [id, c.reloadKey]);

  if (!data || data.incident.id !== id) {
    return (<><div className="card g-tl"><div className="cb"><div className="empty">Loading…</div></div></div><div className="card g-src" /><div className="card g-act" /></>);
  }
  const i = data.incident;
  const done = data.actions.filter((a) => a.status === "Done").length;
  return (
    <>
      <article className="card g-tl">
        <div className="ch"><I n="clock" /><h3>{i.type} <span>· {i.zone_name ?? "Chennai"}</span></h3>
          <button className="more" onClick={() => c.openInc(i.id)} aria-label="Open details"><I n="ext" /></button>
        </div>
        <div className="cb">
          <div className="meta-row" style={{ margin: "0 0 8px" }}><SevChip s={i.sev} /><StChip s={i.status} /><span>{i.complaints} complaints</span></div>
          <Timeline steps={data.timeline} />
        </div>
      </article>
      <article className="card g-src">
        <div className="ch"><I n="layers" /><h3>Source Evidence <span>· {data.members.length}</span></h3></div>
        <div className="cb"><Evidence members={data.members} /></div>
      </article>
      <article className="card g-act">
        <div className="ch"><I n="tasks" /><h3>Action List</h3><span className="cnt-b">{done}/{data.actions.length} done</span>
          <button className="more" onClick={() => setAdding(true)}><I n="plus" />Add</button>
        </div>
        <div className="cb">
          {adding && (
            <form style={{ display: "flex", gap: 6, marginBottom: 8 }} onSubmit={async (e) => {
              e.preventDefault();
              if (await c.addAction(i.id, text)) { setText(""); setAdding(false); }
            }}>
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Deploy suction pump"
                style={{ flex: 1, minWidth: 0, height: 30, borderRadius: 8, border: "1px solid var(--line)", padding: "0 9px", fontSize: 12.5 }} />
              <button className="btn sm">Add</button>
            </form>
          )}
          <Actions data={data} c={c} />
        </div>
      </article>
    </>
  );
}

export function Timeline({ steps }: { steps: Row[] }) {
  return (
    <ul className="vtl">
      {steps.map((s, k) => (
        <li key={k} className={/resolved/i.test(s.label) ? "fin" : /escalat|reject/i.test(s.label) ? "esc" : ""}>
          <i /><time>{fmtShort(s.t)}</time>
          <span>{s.label}<small>{[s.actor, s.note].filter(Boolean).join(" — ")}</small></span>
        </li>
      ))}
    </ul>
  );
}

export function Evidence({ members }: { members: Row[] }) {
  return (
    <>
      {members.map((m) => {
        const k = SOURCE_KIND[m.source] ?? SOURCE_KIND.grievance;
        return (
          <div className="src" key={m.event_id}>
            <span className={`sic ${k.tone}`}><I n={k.ic} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{m.title || k.k}</b>
              <small>{k.k} · {m.source_record_id} · {fmtShort(m.t)}</small>
              {m.text && <q>{String(m.text).slice(0, 180)}{String(m.text).length > 180 ? "…" : ""}</q>}
              <small style={{ color: "var(--accent)" }}>
                {m.role === "first_report" ? "First report" : m.link_prob != null ? `Linked ${Math.round(m.link_prob * 100)}% · ${m.link_method}` : m.role}
                {m.is_overlay ? " · scenario record" : ""}
                {m.deep_link && <> · <a href={m.deep_link} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>open record ↗</a></>}
              </small>
            </span>
          </div>
        );
      })}
    </>
  );
}

const ACT_CLS: Record<string, string> = { Done: "st-resolved", "In progress": "st-open", Pending: "st-progress", Draft: "st-review" };
export function Actions({ data, c }: { data: IncidentDetail; c: Console }) {
  if (!data.actions.length) return <div className="empty">No actions yet. Use Add to create one.</div>;
  return (
    <div className="tbl-wrap">
      <table className="acts">
        <tbody>
          {data.actions.map((a) => (
            <tr key={a.id} className={a.added ? "src-new" : ""} title="Click to move the status forward" onClick={() => c.cycleAction(data.incident.id, a)}>
              <td>{a.text}<div className="dim" style={{ fontSize: 11 }}>{a.owner || a.dept_code}{a.due ? ` · due ${fmtDate(a.due)}` : ""}{a.added ? " · added by Collector" : ""}</div></td>
              <td style={{ textAlign: "right" }}><span className={`st ${ACT_CLS[a.status] ?? "st-review"}`}>{a.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendCard({ d, c, iv }: { d: DeptData; c: Console; iv: () => React.CSSProperties }) {
  const vals = d.trend[c.trend] ?? d.trend.all;
  const n = 12, W = 280, H = 128, mx = Math.max(4, ...vals), bw = W / n;
  const weekStart = (k: number) => new Date(new Date(d.now.replace(" ", "T") + "+05:30").getTime() - (12 - k) * 7 * 864e5).getTime();
  return (
    <article className="card g-tr" style={iv()}>
      <div className="ch"><I n="chart" /><h3>12-Week Trend</h3>
        <select className="sel" value={c.trend} onChange={(e) => c.setTrend(e.target.value)} aria-label="Incident type" style={{ marginLeft: "auto", maxWidth: 150 }}>
          <option value="all">All {shortDept(d.dept.code)} incidents</option>
          {d.trendTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="cb">
        <svg viewBox={`0 0 ${W + 26} ${H + 18}`} className="mini" role="img" aria-label="Weekly incidents">
          {[0, 0.5, 1].map((f) => {
            const y = 12 + (H - 12) * (1 - f);
            return (<g key={f}><line className="grid" x1="24" x2={W + 26} y1={y} y2={y} /><text className="tick" x="18" y={y + 3} textAnchor="end">{Math.round(mx * f)}</text></g>);
          })}
          {vals.map((v, k) => {
            const h = (v / mx) * (H - 12);
            const X = 26 + k * bw + bw * 0.18;
            return (
              <g key={k}>
                <rect className={k === n - 1 ? "bar-last" : "bar"} x={X} y={H - h} width={bw * 0.64} height={Math.max(h, 1)} rx="3"
                  style={{ animationDelay: `${(0.15 + k * 0.03).toFixed(2)}s` }}><title>{`Week of ${fmtDate(weekStart(k))}: ${v}`}</title></rect>
                {(k % 2 === 1 || k === n - 1) && <text className="vl" x={X + bw * 0.32} y={H - h - 4} textAnchor="middle">{v}</text>}
                {(k % 3 === 0 || k === n - 1) && <text className="tick" x={X + bw * 0.32} y={H + 13} textAnchor="middle">{fmtDate(weekStart(k))}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </article>
  );
}
