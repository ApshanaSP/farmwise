"use client";

import type { Overview as OverviewData, Station } from "@/lib/collector/intel";
import type { MapGeo } from "@/lib/collector/geo";
import { I, type IconName } from "./icons";
import SatMap, { type MapStation } from "./SatMap";
import {
  Chart, Cnt, Empty, HBars, SEVS, SEV_HEX, Sources, Spark, deptIcon, fmtDate, fmtTime, fullTitle,
  fmtShort, ms, rel, sevTone, sum, type Row
} from "./lib";
import type { Console } from "./CollectorApp";
import type { Insights } from "@/lib/collector/insights";
import { MarketsCard } from "./Insights";
import { AddedRow } from "./Added";
import { StoriesCard } from "./Stories";
import { useState } from "react";

// =================================================================== page 1 ==

export function Page1({ d, c }: { d: OverviewData; c: Console }) {
  const P = d.periodInfo;
  const env = useEnv(d, c.geo, c);
  const L = c.layout;
  let ix = 0;
  const iv = () => ({ "--i": ix++ }) as React.CSSProperties;

  const KPIS: Record<string, React.ReactNode> = {
    severe: <Kpi key="severe" k="severe" icon="bell" tone="t-sev" label="Severe events" v={d.kpi.cur.severe} p={d.kpi.prev.severe}
      goodDown series={d.kpi.series.severe} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ sev: "Severe" }, "Severe events")} />,
    complaints: <Kpi key="complaints" k="complaints" icon="chat" tone="t-high" label="Open complaints" v={d.kpi.cur.complaints}
      p={d.kpi.prev.complaints} goodDown series={d.kpi.series.complaints} prevLabel={P.prev} style={iv()}
      onClick={() => c.openList({ status: "open", sort: "c" }, "Open complaints")} />,
    ongoing: <Kpi key="ongoing" k="ongoing" icon="doc" tone="t-info" label="Ongoing incidents" v={d.kpi.cur.ongoing} p={d.kpi.prev.ongoing}
      goodDown series={d.kpi.series.ongoing} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ status: "open", sort: "sev", dir: 1 }, "Ongoing incidents")} />,
    resolved: <Kpi key="resolved" k="resolved" icon="checkc" tone="t-low" label={`Resolved this ${P.unit.toLowerCase()}`} v={d.kpi.cur.resolved}
      p={d.kpi.prev.resolved} series={d.kpi.series.resolved} prevLabel={P.prev} style={iv()}
      onClick={() => c.openList({ status: "Resolved" }, "Resolved incidents")} />
  };
  const kpis = L.kpis.filter((k) => KPIS[k]);
  const addedPins = d.added.pins;

  // grid built from the panels the Collector chose to show
  const W: Record<string, string> = { map: "1.1fr", brief: "1.1fr", sev: "1.08fr", tasks: "1fr" };
  const cols = ([["brief", L.panels.brief], ["sev", L.panels.severity], ["tasks", L.panels.tasks]] as const).filter(([, on]) => on).map(([k]) => k);
  const rowB = [...(L.panels.map ? ["map"] : []), ...cols];
  const strip = L.panels.snapshot && cols.length > 0;
  const rowA = [...(L.panels.map ? ["map"] : []), ...(cols.length ? cols.map(() => "snap") : L.panels.snapshot ? ["snap"] : [])];
  const areaRows = strip ? [rowA, rowB] : [cols.length ? rowB : rowA];
  const colKeys = (strip || cols.length ? rowB : rowA);
  const grid: React.CSSProperties = {
    gridTemplateColumns: colKeys.map((k) => `minmax(0,${W[k] ?? "1fr"})`).join(" "),
    gridTemplateRows: strip ? "auto minmax(0,1fr)" : "minmax(0,1fr)",
    gridTemplateAreas: areaRows.map((r) => `"${r.join(" ")}"`).join(" ")
  };

  return (
    <>
      {kpis.length > 0 && <section className="kpis" style={{ gridTemplateColumns: `repeat(${kpis.length},minmax(0,1fr))` }}>{kpis.map((k) => KPIS[k])}</section>}

      <section className="p1" style={grid}>
        {L.panels.map && (
          <article className="card a-map" style={iv()}>
            <div className="ch"><I n="map" />
              <h3>{c.taluk ? <>{c.talukName(c.taluk)} taluk</> : c.zoneName ? c.zoneName : "Chennai District"}</h3>
              <div className="seg sm" style={{ marginLeft: "auto" }} role="tablist" aria-label="Map areas">
                <button className={c.mapMode === "zones" ? "on" : ""} onClick={() => c.setMapMode("zones")} title="GCC zones and wards">Zones</button>
                <button className={c.mapMode === "taluks" ? "on" : ""} onClick={() => c.setMapMode("taluks")} title="Revenue taluks (wards coloured by taluk)">Taluks</button>
              </div>
            </div>
            <div className="map-cb">
              <div className="map-wrap">
                <SatMap geo={c.geo} zoneCounts={d.map.zoneCounts} pins={d.map.pins} zone={d.zone} layers={c.layers} stations={env.mapStations}
                  added={addedPins} onItem={(i) => c.openItem(i)}
                  mode={c.mapMode} taluk={c.taluk} focus={c.focus}
                  onZone={(z) => c.setZone(z)} onTaluk={(t) => c.setTaluk(t)} onPin={(id) => c.openInc(id)} zoneTip={c.zoneTip}
                  onStation={(st) => { c.setEnvSel(st.kind, st.id); c.setPage("environment"); c.toast(`${st.name} selected on the Environment page.`); }} />
                <div className="map-leg">
                  {([["severe", "Severe event"], ["complaint", "Complaint"], ["other", "Other incident"]] as const).map(([k, l]) => (
                    <button key={k} className={c.layers[k] ? "" : "off"} aria-pressed={c.layers[k]} onClick={() => c.toggleLayer(k)}>
                      <i style={{ background: { severe: "#E5484D", complaint: "#FFA114", other: "#4D8DFF" }[k] }} />
                      {l} ({d.map.layerCounts[k].toLocaleString("en-IN")})
                    </button>
                  ))}
                  <button className={c.layers.added ? "" : "off"} aria-pressed={c.layers.added} onClick={() => c.toggleLayer("added")}
                    title="Items from sources you added that name a place in or near Chennai">
                    <i className="dia" style={{ background: "#8B5CF6" }} />
                    From added sources ({addedPins.length})
                  </button>
                  <button className={c.layers.stations ? "" : "off"} aria-pressed={c.layers.stations} onClick={() => c.toggleLayer("stations")}
                    title="A = air quality, R = rain gauge, L = lake or reservoir">
                    <i style={{ background: "linear-gradient(90deg,#12925F 33%,#1560E8 33% 66%,#0891B2 66%)", borderRadius: 3 }} />
                    Stations ({env.mapStations.length})
                  </button>
                </div>
                {c.mapMode === "zones"
                  ? <div className="map-heat"><span>Incidents by zone</span><div /><span><em style={{ fontStyle: "normal" }}>Fewer</em><em style={{ fontStyle: "normal" }}>More</em></span></div>
                  : <div className="map-heat"><span>Colour = revenue taluk</span><span>Click a taluk to filter</span></div>}
              </div>
            </div>
          </article>
        )}

        {L.panels.snapshot && (
          <article className="card a-snap" style={iv()}>
            {d.snapshot.kind === "dept" ? <DeptSnap d={d} c={c} /> : d.snapshot.kind === "area" ? <AreaSnap d={d} c={c} /> : <DistrictSnap d={d} c={c} />}
          </article>
        )}

        {L.panels.brief && <article className="card a-brief" style={iv()}><BriefCard d={d} c={c} /></article>}

        {L.panels.severity && <article className="card a-sev" style={iv()}><SeverityCard d={d} c={c} /></article>}

        {L.panels.tasks && <article className="card a-tasks" style={iv()}><TasksCard d={d} c={c} /></article>}
      </section>
    </>
  );
}

export function Kpi({ k, icon, tone, label, v, p, goodDown, series, prevLabel, style, onClick }: {
  k: string; icon: IconName; tone: string; label: string; v: number; p: number; goodDown?: boolean;
  series: number[]; prevLabel: string; style: React.CSSProperties; onClick: () => void;
}) {
  const diff = v - p;
  const same = diff === 0;
  const cls = same ? "" : (goodDown ? diff < 0 : diff > 0) ? "good" : "bad";
  return (
    <button className="kpi" style={style} onClick={onClick}>
      <span className={`kpi-ic ${tone}`}><I n={icon} /></span>
      <span className="kpi-b">
        <span className="kpi-l">{label}</span>
        <span className="kpi-r">
          <span>
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

// ------------------------------------------------------ severity card --

const SEV_WORD: Record<string, string> = { Severe: "severe", High: "high", Medium: "medium", Low: "low" };

function SeverityCard({ d, c }: { d: OverviewData; c: Console }) {
  const counts = d.severity.counts;
  const first = SEVS.find((s) => counts[s] > 0) ?? "Severe";
  const tab = c.sevTab && (counts[c.sevTab] > 0 || c.sevTab === first) ? c.sevTab : first;
  const rows = d.severity.rows.filter((r) => r.sev === tab);
  return (
    <>
      <div className="ch">
        <svg className="ic" viewBox="0 0 24 24" style={{ color: "var(--sev)" }} aria-hidden="true"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>
        <h3>Severity-based incidents</h3>
        <button className="more" onClick={() => c.openList({ status: "open", sev: tab, sort: "sev", dir: 1 }, `${tab} incidents`)}>See all<I n="right" /></button>
      </div>
      <div className="sevtabs" role="tablist" aria-label="Severity">
        {SEVS.map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} className={`sevtab s-${SEV_WORD[s]}${tab === s ? " on" : ""}`} onClick={() => c.setSevTab(s)}>
            <b className="num">{counts[s].toLocaleString("en-IN")}</b>
            <span><i style={{ background: SEV_HEX[s] }} />{s}</span>
          </button>
        ))}
      </div>
      <div className="fitlist">
        {rows.length ? rows.map((i) => (
          <button key={i.id} className={`si-item${c.focus?.id === i.id ? " on" : ""}`} style={{ "--c": SEV_HEX[i.sev] } as React.CSSProperties}
            onClick={() => { c.highlight(i); c.openInc(i.id); }}>
            <span className={`si-ic ${sevTone(i.sev)}`}><I n={deptIcon(i.dept)} /></span>
            <span className="si-main">
              <span className="si-t" title={fullTitle(i)}>{fullTitle(i)}</span>
              <span className="si-meta">{[i.zone_name, i.dept_name ?? i.dept, rel(i.t, d.now)].filter(Boolean).join(" · ")}</span>
              <span className="si-foot">
                <span className="si-why" title={[...(i.why?.what ?? []), ...(i.why?.why ?? [])].join("\n")}>
                  <I n="alert" />{[i.why?.what?.[0], i.why?.why?.[0]].filter(Boolean).join(" · ") || i.type}
                </span>
                <Sources i={i} />
              </span>
            </span>
          </button>
        )) : <Empty>No open {tab.toLowerCase()} incidents {c.periodLabel.toLowerCase()}.</Empty>}
      </div>
    </>
  );
}

// ------------------------------------------------------------- tasks --

function TasksCard({ d, c }: { d: OverviewData; c: Console }) {
  return (
    <>
      <div className="ch"><I n="tasks" /><h3>My Tasks</h3>
        <span className="cnt-b">{d.tasks.count}</span>
        <button className="more" onClick={() => c.openList({ status: "awaiting", scope: "all", sort: "sev", dir: 1 }, "Complaints awaiting your verification")}>
          See all<I n="right" />
        </button>
      </div>
      <div className="fitlist">
        {d.tasks.rows.length ? d.tasks.rows.map((i) => (
          <div className="task" key={i.id} style={{ "--c": SEV_HEX[i.sev] } as React.CSSProperties}>
            <button className="task-h" onClick={() => c.openInc(i.id)}>
              <b title={fullTitle(i)}>{fullTitle(i)}</b>
            </button>
            <div className="task-act">
              <em title={`${i.dept_name ?? i.dept} · ${i.officer ?? ""}`}>{i.officer ?? i.dept_name ?? "Department officer"} · {i.action ? rel(i.action.t, d.now) : "awaiting you"}</em>
              <span title={i.action?.note ?? undefined}>{i.action ? i.action.note || i.action.step : "Reported the work as done."}</span>
            </div>
            <div className="task-f">
              <Sources i={i} />
              <button className="btn sm plain icon" onClick={() => c.sendBack(i)} disabled={c.busyIds.has(i.id)}
                title="Send back to the department" aria-label="Send back to the department"><I n="refresh" /></button>
              <button className="btn sm ok" onClick={() => c.verify([i])} disabled={c.busyIds.has(i.id)}><I n="check" />Verify</button>
            </div>
          </div>
        )) : <Empty>All caught up. No officer action is waiting for your verification.</Empty>}
      </div>
    </>
  );
}

// ------------------------------------------------------------ snapshot --

function Tile({ onClick, l, v, tone, title, txt }: { onClick?: () => void; l: string; v: React.ReactNode; tone?: string; title?: string; txt?: boolean }) {
  return (
    <button className="stile" onClick={onClick} title={title ?? l}>
      <small>{l}</small>
      <b className={txt ? "txt" : undefined} style={tone ? { color: tone } : undefined}>{v}</b>
    </button>
  );
}

function SnapTitle({ icon, title, sub, more }: { icon: IconName; title: string; sub: string; more?: React.ReactNode }) {
  return (
    <div className="snap-t">
      <b><I n={icon} />{title}</b>
      <small>{sub}</small>
      {more}
    </div>
  );
}

function DistrictSnap({ d, c }: { d: OverviewData; c: Console }) {
  const s = d.snapshot as Extract<OverviewData["snapshot"], { kind: "district" }>;
  const ok = d.feeds.filter((f) => f.status === "ok").length;
  const top = s.topZones.map((z) => z.name);
  return (
    <>
      <SnapTitle icon="chart" title="District Snapshot" sub={c.periodLabel} />
      <div className="snap">
        <Tile onClick={c.openZones} l="Zones monitored" v={<Cnt v={s.zones} />} />
        <Tile onClick={c.openDepts} l="Active depts" v={<Cnt v={s.activeDepts} />} />
        <Tile onClick={() => c.openList({ status: "critical", scope: "all" }, "Severe, not yet verified")} l="Unverified severe"
          v={<Cnt v={s.critical} />} tone="var(--sev)" />
        <Tile onClick={() => s.topZones[0] && c.setZone(s.topZones[0].zone)} l="Hotspot zones" title={top.join(", ")} txt
          v={top.join(", ") || "None"} tone="var(--accent-2)" />
        <Tile onClick={c.openFeeds} l="Data feeds" v={`${ok} / ${d.feeds.length}`} tone={ok === d.feeds.length ? "var(--low)" : "var(--high)"} />
        <Tile onClick={c.openFeeds} l="Last refresh" v={d.exportedAt ? fmtTime(d.exportedAt) : "—"} txt />
      </div>
    </>
  );
}

export function OfficerCard({ o, label, compact }: { o: Row; label?: string; compact?: boolean }) {
  const phones = String(o.phone ?? "").split("/").map((p) => p.trim()).filter(Boolean);
  const initials = String(o.name).replace(/^(Dr\.?|Tmt\.?|Thiru\.?)\s*/i, "").split(/[\s.]+/).filter((x) => x.length > 1).slice(0, 2).map((x) => x[0]).join("");
  return (
    <div className="officer" style={compact ? { gridColumn: "span 2" } : undefined}>
      <span className="avatar">{initials || "GC"}</span>
      <span style={{ minWidth: 0 }}>
        {label && <small style={{ fontWeight: 700, color: "var(--accent-2)" }}>{label}</small>}
        <b>{o.name}</b>
        <small className="desig" title={o.designation}>{o.designation}</small>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 3 }}>
          {phones.slice(0, compact ? 1 : 2).map((p) => <a key={p} href={`tel:${/^\d{8}$/.test(p) ? "044" + p : p.replace(/[^\d+]/g, "")}`}>{p}</a>)}
          {o.email && <a href={`mailto:${String(o.email).split(/[,\s/]+/)[0]}`} title={String(o.email).split(/[,\s/]+/)[0]}>
            {compact ? "Email" : String(o.email).split(/[,\s/]+/)[0]}</a>}
        </span>
      </span>
    </div>
  );
}

function AreaSnap({ d, c }: { d: OverviewData; c: Console }) {
  const s = d.snapshot as Extract<OverviewData["snapshot"], { kind: "area" }>;
  return (
    <>
      <SnapTitle icon="pin" title={c.zoneName ?? "Zone"} sub="Zone snapshot" />
      <div className="snap">
        {s.zoneOfficer && <OfficerCard o={s.zoneOfficer} label="Zonal officer (GCC)" compact />}
        <Tile l="Open incidents" v={<Cnt v={s.active} />} />
        <Tile l="Open complaints" v={<Cnt v={s.complaints} />} />
        <Tile l="Severe incidents" v={<Cnt v={s.severe} />} tone="var(--sev)" />
        <Tile l="Busiest department" title={s.keyDept?.name} v={s.keyDept?.name ?? "—"} tone="var(--accent-2)" txt
          onClick={s.keyDept ? () => c.setDept(s.keyDept.code) : undefined} />
      </div>
    </>
  );
}

function DeptSnap({ d, c }: { d: OverviewData; c: Console }) {
  const s = d.snapshot as Extract<OverviewData["snapshot"], { kind: "dept" }>;
  const dept = s.dept as Row;
  const head = s.contacts.find((x) => x.dept_code === dept.code);
  return (
    <>
      <SnapTitle icon={deptIcon(dept.code)} title={shortName(dept.name)} sub="Department snapshot"
        more={<button className="more" onClick={() => c.openContact(dept, s.contacts)}><I n="phone" />Contacts</button>} />
      <div className="snap">
        {head ? <OfficerCard o={head} label="Department head (GCC)" compact />
          : <div className="officer"><span className="avatar">{shortInit(dept.head)}</span><span><b>{dept.head}</b><small>{dept.org} · not on the GCC website</small></span></div>}
        <Tile l="Open incidents" v={<Cnt v={s.open} />} />
        <Tile l="Officer-verified, open" v={<Cnt v={s.verified} />} />
        <Tile l="Past deadline" v={<Cnt v={s.overdue} />} tone="var(--sev)" />
        <Tile l="Most open in" title={s.topZone?.name} v={s.topZone ? `${s.topZone.name} (${s.topZone.n})` : "—"} tone="var(--accent-2)" txt
          onClick={s.topZone ? () => c.setZone(s.topZone.zone) : undefined} />
      </div>
    </>
  );
}
const shortName = (n: string) => String(n ?? "").replace(/\s*\(.*\)\s*$/, "");
const shortInit = (s: string) => String(s ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

/** Today's Briefing: news the monitor linked to incidents, or items from sources the Collector added. */
function BriefCard({ d, c }: { d: OverviewData; c: Console }) {
  const [tab, setTab] = useState<"news" | "added">("news");
  return (
    <>
      <div className="ch"><I n="news" /><h3>Today&apos;s Briefing</h3>
        <button className="more" onClick={() => (tab === "news" ? c.openNewsAll() : c.openAdded())}>See more<I n="right" /></button>
      </div>
      <div className="btabs" role="tablist" aria-label="Briefing source">
        <button role="tab" aria-selected={tab === "news"} className={tab === "news" ? "on" : ""} onClick={() => setTab("news")}>
          News</button>
        <button role="tab" aria-selected={tab === "added"} className={tab === "added" ? "on" : ""} onClick={() => setTab("added")}
          title={`Items from sources you added, last ${d.added.days} days`}>From added sources <b className="tab-n">{d.added.count}</b></button>
      </div>
      <div className="fitlist">
        {tab === "news"
          ? d.news.length ? d.news.slice(0, 10).map((i) => <NewsItem key={i.id} i={i} now={d.now} c={c} />) : <Empty>No news reports in this period.</Empty>
          : d.added.items.length ? d.added.items.slice(0, 10).map((i: Row) => <AddedRow key={i.item_id} i={i} now={d.now} c={c} />)
            : <Empty>Nothing from added sources in the last {d.added.days} days. <button className="lnk" onClick={() => c.openSources("add")}>Add a source</button></Empty>}
      </div>
    </>
  );
}

export function NewsItem({ i, now, c }: { i: Row; now: string; c: Console }) {
  const outlets: string[] = i.outletNames ?? [];
  return (
    <button className="brief" onClick={() => c.openInc(i.id)}>
      <span className="bic t-high"><I n="news" /></span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <b>{fullTitle(i)}</b>
        <span className="loc">{outlets.length ? outlets.join(", ") : "News"} · {i.zone_name ?? "Chennai"} · {rel(i.t, now)}</span>
        {i.assigned && <span className="routed"><I n="send" />Sent to {i.assigned.officer_designation ?? i.dept_name}</span>}
      </span>
    </button>
  );
}

// ==================================================== environment & markets ==

export function EnvPage({ d, ins, c }: { d: OverviewData; ins: Insights | null; c: Console }) {
  const env = useEnv(d, c.geo, c);
  let ix = 0;
  const iv = () => ({ "--i": ix++ }) as React.CSSProperties;
  return (
    <section className="p2">
      <RainCard d={d} c={c} env={env} style={iv()} />
      <AqiCard c={c} d={d} env={env} style={iv()} />
      <LakeCard c={c} d={d} env={env} style={iv()} />
      <article className="card" style={{ ...iv(), gridColumn: "span 7" }}><MarketsCard ins={ins} c={c} /></article>
      <article className="card" style={{ ...iv(), gridColumn: "span 5" }}><StoriesCard d={d} c={c} /></article>
    </section>
  );
}

// ------------------------------------------------------- environment --

type Kind = "rain" | "aqi" | "lake";
interface Picked { kind: Kind; stations: Station[]; label: string }

/**
 * Which stations each environment card shows. "auto" follows the zone filter:
 * stations inside the zone, else the nearest one (named, with its distance);
 * with no zone it averages every station. The card's picker can override it.
 */
function useEnv(d: OverviewData, geo: MapGeo | null, c: Console) {
  const b = d.bottom;
  const z = d.zone && geo ? geo.zones.find((x) => x.zone === d.zone) : null;
  const zoneName = c.zoneName;
  const km = (st: Station) => {
    if (!z) return 0;
    const dy = (st.lat - z.lat) * 111.2, dx = (st.lon - z.lon) * 111.2 * Math.cos((z.lat * Math.PI) / 180);
    return Math.hypot(dx, dy);
  };
  const pick = (kind: Kind, all: Station[], noun: string): Picked => {
    const sel = c.envSel[kind] ?? "auto";
    const one = all.find((s) => s.id === sel);
    if (one) return { kind, stations: [one], label: one.name };
    if (sel === "all" || !d.zone || !all.length) return { kind, stations: all, label: all.length === 1 ? all[0].name : `Average of ${all.length} ${noun}` };
    const inside = all.filter((s) => s.zone === d.zone);
    if (inside.length) return { kind, stations: inside, label: inside.length === 1 ? `${inside[0].name} (in ${zoneName})` : `${inside.length} ${noun} in ${zoneName}` };
    if (!z) return { kind, stations: all, label: `Average of ${all.length} ${noun}` };
    const near = [...all].sort((a, y) => km(a) - km(y))[0];
    return { kind, stations: [near], label: `Nearest to ${zoneName}: ${near.name}, ${km(near).toFixed(1)} km` };
  };
  const last = (s: Station) => s.series[s.series.length - 1];
  const mapStations: MapStation[] = [
    ...b.aqi.stations.map((s) => ({ id: s.id, name: s.name, kind: "aqi" as const, lat: s.lat, lon: s.lon, label: `AQI ${last(s)}` })),
    ...b.rain.stations.map((s) => ({ id: s.id, name: s.name, kind: "rain" as const, lat: s.lat, lon: s.lon, label: `${last(s)} mm in 24 h` })),
    ...b.lakes.stations.map((s) => ({ id: s.id, name: s.name, kind: "lake" as const, lat: s.lat, lon: s.lon, label: `${last(s)}% full` }))
  ];
  return { rain: pick("rain", b.rain.stations, "rain gauges"), aqi: pick("aqi", b.aqi.stations, "stations"), lake: pick("lake", b.lakes.stations, "lakes"), mapStations };
}
type Env = ReturnType<typeof useEnv>;

/** Average several stations' series, aligned on a time key (the day for rain gauges). */
function combine(stations: Station[], key: (t: string) => string = (t) => t) {
  const by = new Map<string, number[]>();
  for (const s of stations) s.times.forEach((t, k) => { const kk = key(t); (by.get(kk) ?? by.set(kk, []).get(kk)!).push(s.series[k]); });
  const times = [...by.keys()].sort();
  const series = times.map((t) => { const v = by.get(t)!; return Math.round((v.reduce((a, x) => a + x, 0) / v.length) * 10) / 10; });
  return { times, series, now: series[series.length - 1], prev: series.length > 1 ? series[series.length - 2] : null };
}

function StationPicker({ c, kind, all }: { c: Console; kind: Kind; all: Station[] }) {
  return (
    <select className="sel" style={{ marginLeft: "auto", maxWidth: 150 }} value={c.envSel[kind] ?? "auto"} aria-label="Choose station"
      onChange={(e) => c.setEnvSel(kind, e.target.value)}>
      <option value="auto">{c.zone ? "Selected zone" : "All (average)"}</option>
      {c.zone && <option value="all">All (average)</option>}
      {all.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

function Trend({ now, prev, unit, upIsBad, since, dec = 1 }: { now: number | null; prev: number | null; unit: string; upIsBad: boolean; since: string; dec?: number }) {
  if (now == null || prev == null) return null;
  const d = Math.round((now - prev) * 10 ** dec) / 10 ** dec;
  const flat = Math.abs(d) < (dec ? 0.1 : 1);
  const cls = flat ? "flat" : (d > 0) === upIsBad ? "up-bad" : "up-good";
  return (
    <span className={`trend ${cls}`} title={`Previous reading: ${prev} ${unit}`}>
      <span className="arr"><I n={flat ? "right" : d > 0 ? "up" : "down"} /></span>
      <span><b>{flat ? "Steady" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(dec)} ${unit}`}</b><small>vs. {since}</small></span>
    </span>
  );
}

function Level({ text, color }: { text: string; color: string }) {
  return <span className="lvl" style={{ color, background: `${color}1A` }}><i />{text}</span>;
}

function Scale({ stops, value, max }: { stops: { upto: number; c: string; l: string }[]; value: number | null; max: number }) {
  let prev = 0;
  return (
    <div className="scale" aria-hidden="true">
      <div className="bar">{stops.map((s) => { const w = ((s.upto - prev) / max) * 100; prev = s.upto; return <span key={s.l} style={{ background: s.c, flex: `0 0 ${w}%` }} />; })}</div>
      {value != null && <span className="mk" style={{ left: `${Math.min(100, (value / max) * 100)}%` }} />}
      <div className="lb">{(() => { let p = 0; return stops.map((s) => { const w = ((s.upto - p) / max) * 100; p = s.upto; return <span key={s.l} style={{ flex: `0 0 ${w}%` }}>{s.l}</span>; }); })()}</div>
    </div>
  );
}

const RAIN_STOPS = [
  { upto: 15.5, c: "#9FD8B9", l: "Light" }, { upto: 64.4, c: "#F4C542", l: "Moderate" }, { upto: 115.5, c: "#F28A1E", l: "Heavy" }, { upto: 160, c: "#D92D35", l: "Very heavy" }
];
function rainLevel(v: number): [string, string, string] {
  return v < 15.6 ? ["Low", "#12925F", v < 0.1 ? "No rain" : "Light rain"] : v < 64.5 ? ["Moderate", "#B98A00", "Moderate rain"] : v < 115.6 ? ["High", "#E0730D", "Heavy rain"] : ["High", "#D92D35", "Very heavy rain"];
}
const AQI_STOPS = [
  { upto: 50, c: "#3FB67B", l: "Good" }, { upto: 100, c: "#9ACD5A", l: "Satisf." }, { upto: 200, c: "#F4C542", l: "Moderate" },
  { upto: 300, c: "#F28A1E", l: "Poor" }, { upto: 400, c: "#D92D35", l: "V. poor" }, { upto: 500, c: "#8E1B2A", l: "Severe" }
];
function aqiLevel(a: number): [string, string, string] {
  return a <= 50 ? ["Low", "#12925F", "Good"] : a <= 100 ? ["Low", "#12925F", "Satisfactory"] : a <= 200 ? ["Moderate", "#B98A00", "Moderate"]
    : a <= 300 ? ["High", "#E0730D", "Poor"] : ["High", "#D92D35", a <= 400 ? "Very poor" : "Severe"];
}
const LAKE_STOPS = [{ upto: 30, c: "#E5767A", l: "Low" }, { upto: 70, c: "#F4C542", l: "Normal" }, { upto: 100, c: "#3FB67B", l: "High" }];
function lakeLevel(p: number): [string, string, string] {
  return p < 30 ? ["Low", "#D92D35", "Low storage"] : p < 70 ? ["Normal", "#B98A00", "Normal storage"] : p < 92 ? ["High", "#12925F", "Good storage"] : ["High", "#E0730D", "Near full: watch for surplus release"];
}

function EnvHead({ icon, title, c, kind, all }: { icon: IconName; title: string; c: Console; kind: Kind; all: Station[] }) {
  return <div className="ch"><I n={icon} /><h3>{title}</h3><StationPicker c={c} kind={kind} all={all} /></div>;
}

function RainCard({ d, c, env, style }: { d: OverviewData; c: Console; env: Env; style: React.CSSProperties }) {
  const r = combine(env.rain.stations, (t) => t.slice(0, 10));
  const lvl = r.now != null ? rainLevel(r.now) : null;
  const b = d.bottom.rain;
  const days = r.times.slice(-10), vals = r.series.slice(-10);
  return (
    <article className="card env" style={style}>
      <EnvHead icon="cloud" title="Rainfall" c={c} kind="rain" all={b.stations} />
      <div className="cb">
        <div className="env-lbl"><I n="pin" />{env.rain.label}</div>
        <div className="env-top">
          <span className="env-v">{r.now != null ? <Cnt v={r.now} dec={1} /> : "—"}<small>mm / 24 h</small></span>
          {lvl && <Level text={lvl[0]} color={lvl[1]} />}
          <Trend now={r.now} prev={r.prev} unit="mm" upIsBad since="previous day" />
        </div>
        <Scale stops={RAIN_STOPS} value={r.now} max={160} />
        <div className="env-say">
          {lvl ? <><b>{lvl[2]}</b> in the last 24 hours{r.now != null && r.times.length ? ` (IMD, ${fmtDate(r.times[r.times.length - 1])})` : ""}. </> : "No readings. "}
          {b.rainDays} rain day{b.rainDays === 1 ? "" : "s"} in the last {b.days.length} days ({b.prevRainDays} in the {b.days.length} days before).
        </div>
        {vals.some((v) => v > 0) ? <Chart kind="bar" vals={vals} labels={days.map((t) => fmtDate(t))} color="#1560E8" fmt={(v) => `${v} mm`} />
          : <Empty>No rain recorded at {env.rain.stations.length === 1 ? "this gauge" : "these gauges"} in the last {days.length} days.</Empty>}
      </div>
    </article>
  );
}

function AqiCard({ d, c, env, style }: { d: OverviewData; c: Console; env: Env; style: React.CSSProperties }) {
  const a = combine(env.aqi.stations);
  const lvl = a.now != null ? aqiLevel(a.now) : null;
  const worst = env.aqi.stations.length > 1 ? [...env.aqi.stations].sort((x, y) => y.series[y.series.length - 1] - x.series[x.series.length - 1])[0] : null;
  const n = Math.min(a.series.length, 24);
  return (
    <article className="card env" style={style}>
      <EnvHead icon="wind" title="Air quality" c={c} kind="aqi" all={d.bottom.aqi.stations} />
      <div className="cb">
        <div className="env-lbl"><I n="pin" />{env.aqi.label}</div>
        <div className="env-top">
          <span className="env-v">{a.now != null ? <Cnt v={a.now} /> : "—"}<small>AQI</small></span>
          {lvl && <Level text={lvl[0]} color={lvl[1]} />}
          <Trend now={a.now} prev={a.prev} unit="" upIsBad since="previous hour" dec={0} />
        </div>
        <Scale stops={AQI_STOPS} value={a.now} max={500} />
        <div className="env-say">
          {lvl ? <>Air is <b>{lvl[2].toLowerCase()}</b> (CPCB scale). </> : "No readings. "}
          {worst && <>Worst now: <b>{worst.name.replace(/^Chennai-/, "").replace(/, Chennai.*$/, "")}</b> at {worst.series[worst.series.length - 1]}.</>}
        </div>
        <Chart kind="line" vals={a.series.slice(-n)} labels={a.times.slice(-n).map((t) => fmtTime(t))} color="#12925F" fmt={(v) => `AQI ${v}`}
          band={{ at: 100, label: "Satisfactory limit" }} />
      </div>
    </article>
  );
}

function LakeCard({ d, c, env, style }: { d: OverviewData; c: Console; env: Env; style: React.CSSProperties }) {
  const k = combine(env.lake.stations);
  const lvl = k.now != null ? lakeLevel(k.now) : null;
  const first = k.series[0];
  return (
    <article className="card env" style={style}>
      <EnvHead icon="drop" title="Reservoir storage" c={c} kind="lake" all={d.bottom.lakes.stations} />
      <div className="cb">
        <div className="env-lbl"><I n="pin" />{env.lake.label}</div>
        <div className="env-top">
          <span className="env-v">{k.now != null ? <Cnt v={k.now} dec={1} /> : "—"}<small>% full</small></span>
          {lvl && <Level text={lvl[0]} color={lvl[1]} />}
          <Trend now={k.now} prev={k.prev} unit="pts" upIsBad={false} since="previous day" />
        </div>
        <Scale stops={LAKE_STOPS} value={k.now} max={100} />
        <div className="env-say">
          {lvl ? <><b>{lvl[2]}</b>. </> : "No readings. "}
          {k.now != null && first != null && k.series.length > 1 && <>{k.now >= first ? "Up" : "Down"} {Math.abs(k.now - first).toFixed(1)} points since {fmtDate(k.times[0])}.</>}
        </div>
        <Chart kind="line" vals={k.series} labels={k.times.map((t) => fmtDate(t))} color="#0891B2" fmt={(v) => `${v}% full`} />
      </div>
    </article>
  );
}
