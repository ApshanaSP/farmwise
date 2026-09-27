"use client";

import type { Overview as OverviewData } from "@/lib/collector/intel";
import type { MapShapes } from "@/lib/collector/geo";
import { I, type IconName } from "./icons";
import MapSvg, { MapScale } from "./MapSvg";
import {
  Bars, Cnt, Empty, HBars, Line, SevChip, Spark, StChip, deptIcon, fmtDate, fmtTime, fullTitle, isNews, isPortal, ms,
  rel, sevTone, sum, type Row
} from "./lib";
import type { Console } from "./CollectorApp";

export default function Overview({ d, shapes, c }: { d: OverviewData; shapes: MapShapes; c: Console }) {
  const zone = d.zone ? d.zoneTable.find((z) => z.zone === d.zone) : null;
  const tag = zone ? zone.name : "District-wide";
  const P = d.periodInfo;
  let ix = 0;
  const iv = () => ({ "--i": ix++ }) as React.CSSProperties;

  return (
    <>
      <section className="hero" style={iv()}>
        <div>
          <div className="eyebrow"><span>Chennai District</span>·<span>Collector&apos;s Office</span></div>
          <h1>District Intelligence <span className="lt">| Overview</span></h1>
        </div>
        {zone && (
          <span className="fchip"><I n="pin" />Zone: {zone.name}
            <button className="x" onClick={() => c.setZone(null)} aria-label="Clear zone"><I n="x" /></button>
          </span>
        )}
        <DeptSelect c={c} />
        <span className="hero-sp" />
        <div className="hero-meta">
          {P.label}
          <br />
          Data as of <b>{fmtTime(d.now)}</b> · {fmtDate(d.now)}
        </div>
      </section>

      <section className="kpis">
        <Kpi c={c} k="severe" icon="bell" tone="t-sev" label="Severe Events" tag={tag} v={d.kpi.cur.severe} p={d.kpi.prev.severe}
          goodDown series={d.kpi.series.severe} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ sev: "Severe" }, "Severe events")} />
        <Kpi c={c} k="complaints" icon="chat" tone="t-high" label="Open Complaints" tag={tag} v={d.kpi.cur.complaints}
          p={d.kpi.prev.complaints} goodDown series={d.kpi.series.complaints} prevLabel={P.prev} style={iv()}
          onClick={() => c.openList({ status: "open", sort: "c" }, "Open complaints")} />
        <Kpi c={c} k="ongoing" icon="doc" tone="t-info" label="Ongoing Incidents" tag={tag} v={d.kpi.cur.ongoing} p={d.kpi.prev.ongoing}
          goodDown series={d.kpi.series.ongoing} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ status: "open" }, "Ongoing incidents")} />
        <Kpi c={c} k="resolved" icon="checkc" tone="t-low" label={`Resolved This ${P.unit}`} tag={tag} v={d.kpi.cur.resolved}
          p={d.kpi.prev.resolved} series={d.kpi.series.resolved} prevLabel={P.prev} style={iv()}
          onClick={() => c.openList({ status: "Resolved" }, "Resolved incidents")} />
      </section>

      <section className="ov-grid">
        <article className="card a-map" style={iv()}>
          <div className="ch"><I n="map" />
            <h3>{zone ? <>{zone.name} <span>(selected zone)</span></> : "Chennai District Map"}</h3>
            <select className="sel" style={{ marginLeft: "auto" }} value={d.zone ?? ""} aria-label="Select zone"
              onChange={(e) => c.setZone(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Entire Chennai District</option>
              {d.zoneTable.map((z) => <option key={z.zone} value={z.zone}>{z.name}</option>)}
            </select>
          </div>
          <div className="cb map-cb">
            <div className="map-wrap">
              <MapSvg shapes={shapes} zoneCounts={d.map.zoneCounts} pins={d.map.pins} zone={d.zone} mode="overview" layers={c.layers}
                onZone={(z) => c.setZone(z)} onPin={(id) => c.openInc(id)} onTip={c.tip} zoneTip={c.zoneTip} />
              <div className="map-leg">
                {([["severe", "Severe event"], ["complaint", "Complaint"], ["other", "Other incident"]] as const).map(([k, l]) => (
                  <button key={k} className={c.layers[k] ? "" : "off"} aria-pressed={c.layers[k]} onClick={() => c.toggleLayer(k)}>
                    <i style={{ background: { severe: "var(--sev)", complaint: "var(--high)", other: "var(--accent)" }[k] }} />
                    {l} ({d.map.layerCounts[k].toLocaleString("en-IN")})
                  </button>
                ))}
              </div>
              <MapScale />
              <div className="map-tools">
                {zone && <button onClick={() => c.setZone(null)} title="Show whole district"><I n="expand" /></button>}
              </div>
            </div>
          </div>
        </article>

        <article className="card a-snap" style={iv()}>
          {d.snapshot.kind === "area" ? <AreaSnap d={d} c={c} /> : <DistrictSnap d={d} c={c} />}
        </article>

        <article className="card a-brief" style={iv()}>
          <div className="ch"><I n="news" /><h3>Today&apos;s Briefing <span>· news · {zone ? zone.name : "Chennai District"}</span></h3>
            <button className="more" onClick={() => c.openNewsAll()}>See more<I n="right" /></button>
          </div>
          <div className="cb">
            {d.news.length ? d.news.slice(0, 4).map((i) => <NewsItem key={i.id} i={i} now={d.now} c={c} />) : <Empty>No news reports in this period.</Empty>}
          </div>
        </article>

        <article className="card a-tasks" style={iv()}>
          <div className="ch"><I n="tasks" /><h3>My Tasks <span>· {tag}</span></h3>
            <span className="cnt-b">{d.tasks.count}</span>
            <button className="more" onClick={() => c.openList({ status: "unverified", scope: "all", sort: "sev", dir: 1 }, "Awaiting verification")}>
              See all<I n="right" />
            </button>
          </div>
          <div className="cb">
            {d.tasks.rows.length ? d.tasks.rows.slice(0, 5).map((i) => (
              <div className="task" key={i.id}>
                <span className={`bic ${sevTone(i.sev)}`} style={{ width: 32, height: 32, borderRadius: "50%" }}><I n={deptIcon(i.dept)} /></span>
                <div className="tb" onClick={() => c.openInc(i.id)}>
                  <b>{i.type}</b>
                  <span className="ln"><I n="pin" />{i.loc ? `${i.loc}, ` : ""}{i.zone_name}</span>
                  <span className="ln"><I n="clock" />{rel(i.t, d.now)} · {sourceLabel(i)}</span>
                </div>
                <div className="ta">
                  <button className="kebab" onClick={(e) => c.openMenu(i, e)} aria-label="More actions"><I n="dots" /></button>
                  <button className="btn sm" onClick={() => c.verify([i])} disabled={c.busyIds.has(i.id)}>Verify</button>
                </div>
              </div>
            )) : <Empty>All caught up. Nothing waiting for verification.</Empty>}
          </div>
        </article>

        <article className="card a-recent" style={iv()}><RecentCard d={d} c={c} tag={tag} /></article>
        <article className="card a-tl" style={iv()}>{zone ? <HistoryCard d={d} c={c} /> : <PriorityCard d={d} c={c} />}</article>
      </section>

      <section className="bottom"><BottomCards d={d} c={c} iv={iv} tag={tag} /></section>
    </>
  );
}

export function DeptSelect({ c }: { c: Console }) {
  return (
    <label className="dsel">Department
      <select className="sel" value={c.view === "overview" ? "" : c.view} aria-label="Select department"
        onChange={(e) => c.go(e.target.value || "overview")}>
        <option value="">All departments (overview)</option>
        {c.depts.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
      </select>
    </label>
  );
}

export function Kpi({ k, icon, tone, label, tag, v, p, goodDown, series, prevLabel, style, onClick }: {
  c?: Console; k: string; icon: IconName; tone: string; label: string; tag: string; v: number; p: number; goodDown?: boolean;
  series: number[]; prevLabel: string; style: React.CSSProperties; onClick: () => void;
}) {
  const diff = v - p;
  const same = diff === 0;
  const cls = same ? "" : (goodDown ? diff < 0 : diff > 0) ? "good" : "bad";
  return (
    <button className="kpi" style={style} onClick={onClick}>
      <span className={`kpi-ic ${tone}`}><I n={icon} /></span>
      <span className="kpi-b">
        <span className="kpi-l" title={`${label} · ${tag}`}><b>{label}</b></span>
        <span className="kpi-r">
          <span className="kpi-c">
            <span className={`kpi-n ${k === "severe" ? "c-sev" : ""}`}><Cnt v={v} /></span>
            <span className={`kpi-d ${cls}`}>
              <em>{same ? "–" : <I n={diff > 0 ? "up" : "down"} />}{same ? "0" : Math.abs(diff).toLocaleString("en-IN")}</em>vs. {prevLabel}
            </span>
          </span>
          <Spark vals={series} />
        </span>
      </span>
    </button>
  );
}

function sourceLabel(i: Row) {
  const first = String(i.channels ?? i.sources ?? "").split("|")[0];
  return (
    { citizen_app: "Citizen app", citizen_grievance: "Grievance portal", control_room_112: "Control room 112", fir_walk_in: "Police station",
      patrol: "Police patrol", media: "News", field_staff: "Field staff", collector_office: "Collector's office", hospital_mis: "Hospital MIS",
      control_room: "Control room", grievance: "Grievance portal", police: "Police", pwd: "PWD", news: "News" } as Record<string, string>
  )[first] ?? first;
}

function DistrictSnap({ d, c }: { d: OverviewData; c: Console }) {
  const s = d.snapshot as Extract<OverviewData["snapshot"], { kind: "district" }>;
  const Row = ({ onClick, ic, tone, t, v, sm }: { onClick?: () => void; ic: IconName; tone: string; t: string; v: React.ReactNode; sm?: boolean }) => (
    <button className="snap-row" onClick={onClick}>
      <span className={`si ${tone}`}><I n={ic} /></span><span className="t">{t}</span>
      <span className={`v ${sm ? "sm" : ""}`}>{v}</span><I n="chevr" className="go" />
    </button>
  );
  return (
    <>
      <div className="ch"><I n="chart" /><h3>District Snapshot</h3></div>
      <div className="cb">
        <Row onClick={c.openZones} ic="pin" tone="t-info" t="Zones monitored" v={<Cnt v={s.zones} />} />
        <Row onClick={() => s.topZones[0] && c.setZone(s.topZones[0].zone)} ic="alert" tone="t-sev" t="High-priority zones"
          v={s.topZones.map((z) => z.name).join(", ") || "None"} sm />
        <Row onClick={c.openDepts} ic="gov" tone="t-violet" t="Active departments" v={<Cnt v={s.activeDepts} />} />
        <Row onClick={() => c.openList({ status: "critical", scope: "all" }, "Critical items awaiting action")} ic="bolt" tone="t-high"
          t="Critical, awaiting action" v={<span style={{ color: "var(--sev)" }}><Cnt v={s.critical} /></span>} />
        <Row onClick={c.openFeeds} ic="clock" tone="t-low" t="Latest data refresh" v={d.exportedAt ? fmtTime(d.exportedAt) : "—"} sm />
      </div>
    </>
  );
}

function AreaSnap({ d, c }: { d: OverviewData; c: Console }) {
  const s = d.snapshot as Extract<OverviewData["snapshot"], { kind: "area" }>;
  const zone = d.zoneTable.find((z) => z.zone === d.zone);
  return (
    <>
      <div className="ch"><I n="pin" /><h3>{zone?.name} <span>– Zone Overview</span></h3></div>
      <div className="cb">
        <div className="kv">
          <I n="alert" /><span>Active incidents</span><b className="num"><Cnt v={s.active} /></b><hr />
          <I n="chat" /><span>Open complaints</span><b className="num"><Cnt v={s.complaints} /></b><hr />
          <I n="bell" /><span>Severe incidents</span><b className="num" style={{ color: "var(--sev)" }}><Cnt v={s.severe} /></b><hr />
          <I n={deptIcon(s.keyDept?.code)} /><span>Key department</span>
          <b>{s.keyDept ? <button className="lnk" onClick={() => c.go(s.keyDept.code)}>{s.keyDept.name} ›</button> : "—"}</b><hr />
          <I n="user" /><span>Nodal officer</span><b>{s.keyDept?.head ?? "—"}</b><hr />
          <I n="clock" /><span>Latest update</span>
          <b title={s.latest?.title}>{s.latest ? `${fmtTime(s.latest.at)} · ${s.latest.step}` : "—"}</b>
        </div>
      </div>
    </>
  );
}

export function NewsItem({ i, now, c }: { i: Row; now: string; c: Console }) {
  const outlets: string[] = i.outletNames ?? [];
  return (
    <button className="brief" onClick={() => c.openInc(i.id, "news")}>
      <span className="bic t-info"><I n="news" /></span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <b>{fullTitle(i)}</b>
        <span className="loc">{i.zone_name ?? "Chennai"} · {i.dept_name ?? i.dept} · {rel(i.t, now)}</span>
        {i.summary && <p>{i.summary}</p>}
        <span className="news-ol">Reported by {outlets.length || i.outlets}:
          {outlets.map((n) => <span key={n} className="chip chip-np">{n}</span>)}
        </span>
      </span>
    </button>
  );
}

function RecentCard({ d, c, tag }: { d: OverviewData; c: Console; tag: string }) {
  // "All" also includes police, PWD and hospital records, which the portal and news tabs leave out.
  const f = c.rtab === "portal" ? isPortal : c.rtab === "news" ? isNews : () => true;
  const seen = new Set<string>();
  const rows = d.recent
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .filter(f)
    .sort((a, b) => ms(b.t) - ms(a.t))
    .slice(0, 8);
  return (
    <>
      <div className="ch">
        <svg className="ic" viewBox="0 0 24 24" style={{ color: "var(--sev)" }} aria-hidden="true"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>
        <h3>Recent Incidents <span>· {tag}</span></h3>
        <div className="tabs">
          {([["all", "All"], ["portal", "Grievance portal"], ["news", "News"]] as const).map(([k, l]) => (
            <button key={k} className={c.rtab === k ? "on" : ""} onClick={() => c.setRtab(k)}>{l}</button>
          ))}
        </div>
        <button className="more" onClick={() => c.openList({}, "All incidents")}>See more<I n="right" /></button>
      </div>
      <div className="cb">
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>#</th><th>Complaint / report</th><th>Source</th><th>{d.zone ? "Location" : "Zone"}</th><th>Department</th><th>Status</th><th>Severity</th><th>Time</th></tr></thead>
            <tbody>
              {rows.map((i, n) => (
                <tr key={i.id} onClick={() => c.openInc(i.id, !isPortal(i) && isNews(i) ? "news" : undefined)}>
                  <td className="dim">{n + 1}</td>
                  <td className="ev">{i.type}</td>
                  <td>{isPortal(i) && <span className="chip chip-portal"><I n="app" />Grievance portal</span>} {isNews(i) && <span className="chip chip-src"><I n="news" />News</span>}
                    {!isPortal(i) && !isNews(i) && <span className="chip chip-src">{String(i.sources).split("|").map((s: string) => s.toUpperCase()).join(" + ")}</span>}</td>
                  <td>{d.zone ? i.loc ?? "—" : i.zone_name ?? "—"}</td>
                  <td>{i.dept_name ?? i.dept}</td>
                  <td><StChip s={i.status} /></td>
                  <td><SevChip s={i.sev} /></td>
                  <td className="dim num">{fmtTime(i.t)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8}><div className="empty">No complaints or news reports</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function PriorityCard({ d, c }: { d: OverviewData; c: Console }) {
  return (
    <>
      <div className="ch"><I n="clock" /><h3>Priority Incident Timeline</h3>
        <button className="more" onClick={() => c.openList({ status: "open", sort: "sev", dir: 1 }, "Open incidents")}>See all<I n="right" /></button>
      </div>
      <div className="cb">
        {d.priority.length ? d.priority.map((i) => {
          const tl = i.timeline as Row[];
          const nodes = tl.length > 3 ? [tl[0], tl[Math.floor(tl.length / 2)], tl[tl.length - 1]] : tl;
          const t0 = ms(i.t);
          const span = Math.max(1, ms(d.now) - t0);
          const last = nodes.length ? ms(nodes[nodes.length - 1].t) : t0;
          return (
            <button className="ptl" key={i.id} onClick={() => c.openInc(i.id)}>
              <span className="ptl-h"><b>{i.type} – {i.zone_name ?? "Chennai"}</b><SevChip s={i.sev} /><span className="r"><StChip s={i.status} /></span></span>
              <span className="track">
                <span className="ln"><i style={{ width: `${Math.min(100, ((last - t0) / span) * 100)}%` }} /></span>
                {nodes.map((n, k) => (
                  <span key={k} className={`nd ${k === nodes.length - 1 ? "last" : ""}`}
                    style={{ left: `${Math.max(6, Math.min(88, ((ms(n.t) - t0) / span) * 88 + 6))}%` }} title={n.label}>
                    <s />{fmtTime(n.t)}
                  </span>
                ))}
              </span>
            </button>
          );
        }) : <Empty>No open incidents.</Empty>}
      </div>
    </>
  );
}

function HistoryCard({ d, c }: { d: OverviewData; c: Console }) {
  const opts = d.priority;
  if (!opts.length) return (<><div className="ch"><I n="clock" /><h3>Incident History</h3></div><div className="cb"><Empty>No open incidents in this period.</Empty></div></>);
  const i = opts.find((o) => o.id === c.hist) ?? opts[0];
  const tl = (i.timeline as Row[]).slice(-5);
  return (
    <>
      <div className="ch"><I n="tasks" /><h3>Incident History</h3>
        <select className="sel" style={{ marginLeft: "auto", maxWidth: 190 }} value={i.id} onChange={(e) => c.setHist(e.target.value)} aria-label="Choose incident">
          {opts.map((o) => <option key={o.id} value={o.id}>{o.type} · {o.loc ?? o.zone_name}</option>)}
        </select>
      </div>
      <div className="cb">
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <button className="lnk" onClick={() => c.openInc(i.id)} style={{ fontSize: 12.5 }}>{fullTitle(i)} ›</button><SevChip s={i.sev} />
        </div>
        <div className="stepper" style={{ gridTemplateColumns: `repeat(${tl.length},minmax(70px,1fr))` }}>
          <span className="rail" style={{ left: `${50 / tl.length}%`, right: `${50 / tl.length}%` }} />
          {tl.map((s, k) => (
            <div className="step" key={k}>
              <span className="sl">{k + 1}. {s.label}</span>
              <span className={`sd ${k === 0 ? "first" : ""} ${s.label === "Resolved" || k === tl.length - 1 ? "fin" : ""}`}>{k ? <I n="check" /> : null}</span>
              <b>{fmtTime(s.t)}</b>
              <span className="sn">{s.note || s.actor}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function aqiBand(a: number): [string, string] {
  return a <= 50 ? ["Good", "t-low"] : a <= 100 ? ["Satisfactory", "t-low"] : a <= 200 ? ["Moderate", "t-med"] : ["Poor", "t-sev"];
}

function BottomCards({ d, c, iv, tag }: { d: OverviewData; c: Console; iv: () => React.CSSProperties; tag: string }) {
  const b = d.bottom;
  const dTop = b.byDept.slice(0, 4).map((r) => ({ l: r.l, v: r.v, onClick: () => c.go(r.code) }));
  const oth = sum(b.byDept.slice(4), (r) => r.v);
  if (oth) dTop.push({ l: "Other", v: oth, onClick: () => c.openDepts() });
  const zRows = b.byZone.map((r) => ({
    l: r.l, v: r.v,
    onClick: () => (d.zone ? c.openList({ q: r.l }, `Incidents at ${r.l}`) : r.zone && c.setZone(r.zone))
  }));
  const rain = b.rain;
  const rainPct = rain.prevRainDays ? Math.round(((rain.rainDays - rain.prevRainDays) / rain.prevRainDays) * 100) : null;
  const aqi = b.aqi;
  const band = aqi.latest != null ? aqiBand(aqi.latest) : null;
  const lakes = b.lakes;
  const lNow = lakes.series[lakes.series.length - 1];
  const lPct = lakes.series.length > 1 ? lNow - lakes.series[0] : 0;
  return (
    <>
      <article className="card" style={iv()}>
        <div className="ch"><I n="chart" /><h3>Complaints by Department</h3><span className="more" style={{ color: "var(--text-3)", fontWeight: 500 }}>{d.periodInfo.label}</span></div>
        <div className="cb">{dTop.length ? <HBars rows={dTop} /> : <div className="empty">No citizen complaints in this period</div>}</div>
      </article>
      <article className="card" style={iv()}>
        <div className="ch"><I n="pin" /><h3>Top {d.zone ? "Locations" : "Zones"} <span>· open complaints</span></h3></div>
        <div className="cb">{zRows.length ? <HBars rows={zRows} /> : <div className="empty">No open complaints</div>}</div>
      </article>
      <article className="card" style={iv()}>
        <div className="ch"><I n="cloud" /><h3>Rainfall <span>· {tag}</span></h3></div>
        <div className="cb">
          <div className="env-top">
            <span className="big">{rain.latestMm != null ? <><Cnt v={rain.latestMm} dec={1} /> <small>mm / 24 h</small></> : "—"}</span>
            <span className={`delta ${rainPct != null && rainPct > 0 ? "up-bad" : "up-good"}`}>
              {rain.rainDays} rain day{rain.rainDays === 1 ? "" : "s"}
              <small>{rainPct != null ? `${rainPct > 0 ? "+" : ""}${rainPct}% vs. ${d.periodInfo.prev}` : `IMD, ${rain.latestAt ? fmtDate(rain.latestAt) : ""}`}</small>
            </span>
          </div>
          <Bars vals={rain.series} labels={rain.days.map((x) => fmtDate(x))} unit="(rain intensity index)" />
        </div>
      </article>
      <article className="card" style={iv()}>
        <div className="ch"><I n="wind" /><h3>Air Quality <span>· citywide</span></h3></div>
        <div className="cb">
          <div className="env-top">
            <span className="big"><small>AQI</small> {aqi.latest != null ? <Cnt v={aqi.latest} /> : "—"}</span>
            {aqi.worst != null && <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>worst station <b className="num">{aqi.worst}</b></span>}
            {band && <span className={`aqi-b ${band[1]}`}>{band[0]}</span>}
          </div>
          <Line vals={aqi.series} labels={aqi.times.map((t) => fmtTime(t))} color="#16A06A" fmt={(v) => `AQI ${v}`} />
        </div>
      </article>
      <article className="card" style={iv()}>
        <div className="ch"><I n="drop" /><h3>Reservoir Storage <span>· 18 lakes</span></h3></div>
        <div className="cb">
          <div className="env-top">
            <span className="big">{lNow != null ? <><Cnt v={lNow} dec={1} /> <small>% full</small></> : "—"}</span>
            <span className={`delta ${lPct >= 0 ? "up-good" : "up-bad"}`}><I n={lPct >= 0 ? "up" : "down"} />{Math.abs(lPct).toFixed(1)} pts<small>over period</small></span>
          </div>
          <Line vals={lakes.series} labels={lakes.days.map((x) => fmtDate(x))} color="#1560E8" fmt={(v) => `${v}% full`} />
        </div>
      </article>
    </>
  );
}
