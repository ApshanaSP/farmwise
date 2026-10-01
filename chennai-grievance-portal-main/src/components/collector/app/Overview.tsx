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
import { useState } from "react";

// =================================================================== page 1 ==

export function Page1({ d, c }: { d: OverviewData; c: Console }) {
  const P = d.periodInfo;
  const env = useEnv(d, c.geo, c);
  const L = c.layout;
  let ix = 0;
  const iv = () => ({ "--i": ix++ }) as React.CSSProperties;

  // With a department selected, open complaints and ongoing incidents are nearly the same
  // things counted twice (each complaint is usually one incident), so they become one tile.
  const merged = !!c.dept;
  const KPIS: Record<string, React.ReactNode> = {
    severe: <Kpi key="severe" k="severe" icon="bell" tone="t-sev" label="Severe events" v={d.kpi.cur.severe} p={d.kpi.prev.severe}
      goodDown series={d.kpi.series.severe} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ sev: "Severe" }, "Severe events")}
      tip="Incidents rated severe (danger to life, major damage or many people affected), reported in the period, open or closed." />,
    complaints: merged ? null : <Kpi key="complaints" k="complaints" icon="chat" tone="t-high" label="Open complaints" v={d.kpi.cur.complaints}
      p={d.kpi.prev.complaints} goodDown series={d.kpi.series.complaints} prevLabel={P.prev} style={iv()}
      onClick={() => c.openList({ status: "open", sort: "c" }, "Open complaints")}
      tip="Citizen complaints on incidents that are still open. One incident can have several complaints." />,
    ongoing: <Kpi key="ongoing" k="ongoing" icon="doc" tone="t-info" label={merged ? "Open incidents" : "Ongoing incidents"} v={d.kpi.cur.ongoing} p={d.kpi.prev.ongoing}
      goodDown series={d.kpi.series.ongoing} prevLabel={P.prev} style={iv()} onClick={() => c.openList({ status: "open", sort: "sev", dir: 1 }, "Open incidents")}
      note={merged ? `${d.kpi.cur.complaints.toLocaleString("en-IN")} citizen complaints` : undefined}
      tip="Incidents reported in the period that are not yet resolved. The same incidents are split by severity in the card below." />,
    resolved: <Kpi key="resolved" k="resolved" icon="checkc" tone="t-low" label={period1(c) ? "Resolved today" : `Resolved this ${P.unit.toLowerCase()}`} v={d.kpi.cur.resolved}
      p={d.kpi.prev.resolved} series={d.kpi.series.resolved} prevLabel={P.prev} style={iv()}
      onClick={() => c.openList({ status: "Resolved" }, "Resolved incidents")}
      tip="Incidents reported in the period that the department has already resolved." />
  };
  const kpis = L.kpis.filter((k) => KPIS[k]);
  const addedPins = d.added.pins;

  // The map runs the full height on the left, where it has room to pan and zoom. On the right,
  // the district snapshot is one horizontal strip, and under it the three working lists side by
  // side: what is urgent (severity), what to check (tasks), and today's news.
  const right = ([["sev", L.panels.severity], ["tasks", L.panels.tasks], ["brief", L.panels.brief]] as const).filter(([, on]) => on).map(([k]) => k as string);
  const W: Record<string, string> = { map: "1.45fr", sev: "1fr", tasks: "1fr", brief: "1.15fr" };
  const cols = [...(L.panels.map ? ["map"] : []), ...right];
  const strip = L.panels.snapshot;
  const top = [...(L.panels.map ? ["map"] : []), ...(right.length ? right.map(() => "snap") : ["snap"])];
  const rows = strip && right.length ? [top, cols] : strip ? [top] : [cols];
  const grid: React.CSSProperties = {
    gridTemplateColumns: (strip && !right.length ? top : cols).map((k) => `minmax(0,${W[k] ?? "1fr"})`).join(" "),
    gridTemplateRows: rows.length > 1 ? "auto minmax(0,1fr)" : "minmax(0,1fr)",
    gridTemplateAreas: rows.map((r) => `"${r.join(" ")}"`).join(" ")
  };
  const LAYERS = [
    ["severe", "Severe", "#E5484D", d.map.layerCounts.severe], ["complaint", "Complaints", "#FFA114", d.map.layerCounts.complaint],
    ["other", "Other", "#4D8DFF", d.map.layerCounts.other]
  ] as const;

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
                {c.mapMode === "zones"
                  ? <div className="map-heat"><span>Incidents by zone</span><div /><span><em>Fewer</em><em>More</em></span></div>
                  : <div className="map-heat"><span>Colour = revenue taluk</span></div>}
              </div>
            </div>
            {/* the legend sits under the map, so nothing covers the map itself; each item turns its pins on or off */}
            <div className="map-leg2" role="group" aria-label="Show on the map">
              {LAYERS.map(([k, l, col, n]) => (
                <button key={k} className={c.layers[k] ? "" : "off"} aria-pressed={c.layers[k]} onClick={() => c.toggleLayer(k)} title={`Show or hide ${l.toLowerCase()} pins`}>
                  <i style={{ background: col }} />{l}<b>{n.toLocaleString("en-IN")}</b>
                </button>
              ))}
              <button className={c.layers.added ? "" : "off"} aria-pressed={c.layers.added} onClick={() => c.toggleLayer("added")}
                title="Items from sources you added that name a place in or near Chennai">
                <i className="dia" style={{ background: "#8B5CF6" }} />Added<b>{addedPins.length}</b>
              </button>
              <button className={c.layers.stations ? "" : "off"} aria-pressed={c.layers.stations} onClick={() => c.toggleLayer("stations")}
                title="Air-quality stations, rain gauges and lakes">
                <i className="sq" style={{ background: "linear-gradient(90deg,#12925F 33%,#1560E8 33% 66%,#0891B2 66%)" }} />Stations<b>{env.mapStations.length}</b>
              </button>
            </div>
          </article>
        )}

        {strip && (
          <article className="card a-snap" style={iv()}>
            {d.snapshot.kind === "dept" ? <DeptSnap d={d} c={c} /> : d.snapshot.kind === "area" ? <AreaSnap d={d} c={c} /> : <DistrictSnap d={d} c={c} />}
          </article>
        )}

        {L.panels.severity && <article className="card a-sev" style={iv()}><SeverityCard d={d} c={c} /></article>}
        {L.panels.tasks && <article className="card a-tasks" style={iv()}><TasksCard d={d} c={c} /></article>}
        {L.panels.brief && <article className="card a-brief" style={iv()}><BriefCard d={d} c={c} /></article>}
      </section>
    </>
  );
}

export function Kpi({ k, icon, tone, label, v, p, goodDown, series, prevLabel, style, onClick, tip, note }: {
  k: string; icon: IconName; tone: string; label: string; v: number; p: number; goodDown?: boolean;
  series: number[]; prevLabel: string; style: React.CSSProperties; onClick: () => void;
  /** what the number counts, in plain words (hover) */ tip?: string; /** a second fact shown after the label */ note?: string;
}) {
  const diff = v - p;
  const same = diff === 0;
  const cls = same ? "" : (goodDown ? diff < 0 : diff > 0) ? "good" : "bad";
  return (
    <button className="kpi" style={style} onClick={onClick} title={tip ? `${tip} Click for the list.` : undefined}>
      <span className={`kpi-ic ${tone}`}><I n={icon} /></span>
      <span className="kpi-b">
        <span className="kpi-l">{label}{note && <em className="kpi-note">· {note}</em>}</span>
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
  const needN = rows.filter((r) => r.why?.needsYou).length;
  return (
    <>
      <div className="ch">
        <svg className="ic" viewBox="0 0 24 24" style={{ color: "var(--sev)" }} aria-hidden="true"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>
        <h3 title="Open incidents by severity">By severity</h3>
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
      {rows.length > 0 && (
        <div className="sev-note">{needN ? <><I n="bell" /><b>{needN} need{needN === 1 ? "s" : ""} you</b>, shown first</> : <><I n="checkc" />All routine for the departments</>}</div>
      )}
      <div className="fitlist">
        {rows.length ? [...rows].sort((a, b) => Number(!!b.why?.needsYou) - Number(!!a.why?.needsYou)).map((i) => (
          <button key={i.id} className={`si-item${c.focus?.id === i.id ? " on" : ""}${i.why?.needsYou ? " need" : ""}`} style={{ "--c": SEV_HEX[i.sev] } as React.CSSProperties}
            onClick={() => { c.highlight(i); c.openInc(i.id); }}>
            <span className={`si-ic ${sevTone(i.sev)}`}><I n={deptIcon(i.dept)} /></span>
            <span className="si-main">
              <span className="si-t" title={fullTitle(i)}>{fullTitle(i)}</span>
              <span className="si-meta">{[i.zone_name, i.dept_name ?? i.dept, rel(i.t, d.now)].filter(Boolean).join(" · ")}</span>
              {i.why?.needsYou && (
                <span className="si-why" title={i.why.attention.join("\n")}><I n="bell" />{i.why.attention[0]}</span>
              )}
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
      <div className="ch"><I n="tasks" /><h3 title="Closed work for you to check">My Tasks</h3>
        <span className="cnt-b">{d.tasks.count}</span>
        <button className="more" onClick={() => c.openList({ status: "awaiting", scope: "all", sort: "sev", dir: 1 }, "Closed work for you to check")}>
          See all<I n="right" />
        </button>
      </div>
      <div className="task-rule" title={TASK_RULE}>
        <I n="alert" /><span>{d.tasks.leftToDepts > 0 ? <><b>{d.tasks.leftToDepts}</b> routine closures left to departments</> : "Only important closures come to you"}</span>
      </div>
      <div className="fitlist">
        {d.tasks.rows.length ? d.tasks.rows.map((i) => (
          <div className="task" key={i.id} style={{ "--c": SEV_HEX[i.sev] } as React.CSSProperties}>
            <button className="task-h" onClick={() => c.openInc(i.id)} title={fullTitle(i)}><b>{fullTitle(i)}</b></button>
            <div className="task-act" title={`${i.officer ?? i.dept_name ?? "Department officer"}: ${i.action ? i.action.note || i.action.step : "reported the work as done"}`}>
              <em>{i.officer ?? i.dept_name ?? "Officer"}{i.action ? `, ${rel(i.action.t, d.now)}` : ""}:</em> {i.action ? i.action.note || i.action.step : "Reported the work as done."}
            </div>
            <div className="task-f">
              <span className="task-why" title={`With you because: ${(i.because as string[]).join(", ")}`}>{(i.because as string[]).slice(0, 2).map((b) => <i key={b}>{b}</i>)}</span>
              <button className="btn sm plain icon" onClick={() => c.sendBack(i)} disabled={c.busyIds.has(i.id)}
                title="Not satisfied: send it back to the department" aria-label="Send back to the department"><I n="refresh" /></button>
              <button className="btn sm ok" onClick={() => c.verify([i])} disabled={c.busyIds.has(i.id)} title="The work is done: close it"><I n="check" />Verify</button>
            </div>
          </div>
        )) : <Empty>All caught up. Nothing needs your check right now.</Empty>}
      </div>
    </>
  );
}

const TASK_RULE = "You check closed work only when it is severe or high severity, has 3 or more citizen complaints, needs several departments, " +
  "was reported in the news, or (medium severity) took more than twice its deadline. Everything else is checked by the department head.";

// ------------------------------------------------------------ snapshot --

function Tile({ onClick, l, v, tone, title, txt }: { onClick?: () => void; l: string; v: React.ReactNode; tone?: string; title?: string; txt?: boolean }) {
  return (
    <button className={`stile${onClick ? "" : " static"}`} onClick={onClick} title={title ?? l} disabled={!onClick}>
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

/**
 * The two tiles every snapshot shares. None repeats the KPI tiles above: they count open
 * incidents that are severe or high, or past their deadline. (What is only in the news is a
 * tab of Today's Briefing, where the reports can be read.)
 */
function CommonTiles({ s, c }: { s: { serious: number; overdue: number }; c: Console }) {
  const p = c.periodLabel.toLowerCase();
  return (
    <>
      <Tile l="Severe or high, still open" v={<Cnt v={s.serious} />} tone={s.serious ? "var(--sev)" : undefined}
        title={`Open incidents rated severe or high, reported in the ${p}. Click for the list.`}
        onClick={() => c.openList({ status: "open", sort: "sev", dir: 1 }, "Open incidents, most severe first")} />
      <Tile l="Past deadline, still open" v={<Cnt v={s.overdue} />} tone={s.overdue ? "var(--high)" : undefined}
        title={`Open incidents that have missed their resolution deadline, reported in the ${p}. Click for the list.`}
        onClick={() => c.openList({ status: "overdue", sort: "sev", dir: 1 }, "Open and past deadline")} />
    </>
  );
}

/** "Daily · last 24 hours": the period's name and what it covers. */
const periodSub = (c: Console) => `${PERIOD_NAME[c.period]} · ${c.periodLabel.toLowerCase()}`;
const period1 = (c: Console) => c.period === "daily";
const PERIOD_NAME: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" };

function DistrictSnap({ d, c }: { d: OverviewData; c: Console }) {
  const s = d.snapshot as Extract<OverviewData["snapshot"], { kind: "district" }>;
  const top = s.topZones.map((z) => z.name);
  const p = c.periodLabel.toLowerCase();
  return (
    <>
      <SnapTitle icon="chart" title="District Snapshot" sub={`${periodSub(c)} · hover a tile for what it counts`} />
      <div className="snap">
        <Tile l="Most serious zones" txt v={top.join(", ") || "None"} tone="var(--accent-2)"
          title={`GCC zones with the most severe and high incidents reported in the ${p} (a severe incident counts 3, a high one 1). ` +
            `This is about seriousness now; "Most open work" below is about backlog. Click to show ${top[0] ?? "the first zone"}.`}
          onClick={s.topZones[0] ? () => c.setZone(s.topZones[0].zone) : undefined} />
        <Tile l="Most open work (taluk)" txt v={s.topTaluk ? `${s.topTaluk.name} · ${s.topTaluk.n}` : "None"} tone="var(--accent-2)"
          title={`Revenue taluk with the most incidents still open, among those reported in the ${p}. Taluks and GCC zones have different boundaries.`} />
        <CommonTiles s={s} c={c} />
        <Tile l="Severe, not yet checked" v={<Cnt v={s.critical} />} tone={s.critical ? "var(--sev)" : undefined}
          title="Open severe incidents that no officer has confirmed on the ground yet (any date). Click for the list."
          onClick={() => c.openList({ status: "critical", scope: "all" }, "Severe, not yet checked")} />
      </div>
    </>
  );
}

export function OfficerCard({ o, label, compact }: { o: Row; label?: string; compact?: boolean }) {
  const phones = String(o.phone ?? "").split("/").map((p) => p.trim()).filter(Boolean);
  const initials = String(o.name).replace(/^(Dr\.?|Tmt\.?|Thiru\.?)\s*/i, "").split(/[\s.]+/).filter((x) => x.length > 1).slice(0, 2).map((x) => x[0]).join("");
  return (
    <div className={`officer${compact ? " compact" : ""}`}>
      <span className="avatar">{initials || "GC"}</span>
      <span style={{ minWidth: 0 }}>
        {label && <small className="olabel">{label}</small>}
        <b title={o.name}>{o.name}</b>
        <small className="desig" title={o.designation}>{o.designation}</small>
        <span className="ocontact">
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
      <SnapTitle icon="pin" title={c.zoneName ?? "Zone"} sub={`Zone snapshot · ${periodSub(c)}`} />
      <div className="snap">
        {s.zoneOfficer ? <OfficerCard o={s.zoneOfficer} label="Zonal officer (GCC)" compact />
          : <div className="officer compact"><span className="avatar">ZO</span><span><b>Zonal officer</b><small>Not listed on the GCC website</small></span></div>}
        <CommonTiles s={s} c={c} />
        <Tile l="Busiest department" title={`Department with the most open incidents in this zone (${c.periodLabel.toLowerCase()}): ${s.keyDept?.name ?? "none"}${s.keyDept ? `, ${s.keyDept.n}` : ""}. Click to show only it.`}
          v={s.keyDept?.name ?? "—"} tone="var(--accent-2)" txt onClick={s.keyDept ? () => c.setDept(s.keyDept.code) : undefined} />
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
      <SnapTitle icon={deptIcon(dept.code)} title={shortName(dept.name)} sub={`Department snapshot · ${periodSub(c)}`}
        more={<button className="more" onClick={() => c.openContact(dept, s.contacts)}><I n="phone" />All contacts</button>} />
      <div className="snap">
        {head ? <OfficerCard o={head} label="Department head (GCC)" compact />
          : <div className="officer compact"><span className="avatar">{shortInit(dept.head)}</span>
            <span style={{ minWidth: 0 }}><small className="olabel">Department head</small><b title={dept.head}>{dept.head}</b><small className="desig">{dept.org}</small></span></div>}
        <CommonTiles s={s} c={c} />
        <Tile l="Most open work in" title={s.topZone ? `${s.topZone.name} zone has the most open incidents for this department (${s.topZone.n}). Click to show only it.` : undefined}
          v={s.topZone ? `${s.topZone.name} · ${s.topZone.n}` : "—"} tone="var(--accent-2)" txt
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
  const when = c.period === "daily" ? "today" : `last ${d.added.days} days`;
  return (
    <>
      <div className="ch"><I n="news" /><h3>Today&apos;s Briefing</h3>
        <button className="more" onClick={() => (tab === "news" ? c.openNewsAll() : c.openAdded())}>See more<I n="right" /></button>
      </div>
      <div className="btabs" role="tablist" aria-label="Briefing source">
        <button role="tab" aria-selected={tab === "news"} className={tab === "news" ? "on" : ""} onClick={() => setTab("news")}>
          News</button>
        <button role="tab" aria-selected={tab === "added"} className={tab === "added" ? "on" : ""} onClick={() => setTab("added")}
          title={`Items from sources you added, ${when}`}>From added sources <b className="tab-n">{d.added.count}</b></button>
      </div>
      <div className="fitlist">
        {tab === "news"
          ? d.news.length ? uniqueNews(d.news).slice(0, 10).map((i) => <NewsItem key={i.id} i={i} now={d.now} c={c} />) : <Empty>No news reports {c.period === "daily" ? "today" : "in this period"}.</Empty>
          : d.added.items.length ? d.added.items.slice(0, 10).map((i: Row) => <AddedRow key={i.item_id} i={i} now={d.now} c={c} />)
            : <Empty>Nothing from added sources {when === "today" ? "today" : `in the ${when}`}. <button className="lnk" onClick={() => c.openSources("add")}>Add a source</button></Empty>}
      </div>
    </>
  );
}

/** The same headline linked to two incidents (one story, two places) is shown once. */
function uniqueNews(rows: Row[]) {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = fullTitle(r).toLowerCase().replace(/\s+/g, " ").trim();
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export function NewsItem({ i, now, c, showDept }: { i: Row; now: string; c: Console; showDept?: boolean }) {
  const outlets: string[] = i.outletNames ?? [];
  return (
    <button className="brief" onClick={() => c.openInc(i.id)}>
      <span className="bic t-high"><I n="news" /></span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <b>{fullTitle(i)}</b>
        <span className="loc">{outlets.length ? outlets.join(", ") : "News"} · {i.zone_name ?? "Chennai"} · {rel(i.t, now)}</span>
        {showDept && !i.assigned && <span className="routed"><I n="gov" />Belongs to {i.dept_name ?? i.dept}</span>}
        {i.assigned && <span className="routed"><I n="send" />Sent to {i.assigned.officer_designation ?? i.dept_name}</span>}
      </span>
    </button>
  );
}

// ==================================================== environment & markets ==

/** Page 4: weather, water and prices for the whole district. No zone or department filter applies here. */
export function EnvPage({ d, ins, c }: { d: OverviewData; ins: Insights | null; c: Console }) {
  const env = useEnv(d, c.geo, c, true);
  let ix = 0;
  const iv = () => ({ "--i": ix++ }) as React.CSSProperties;
  return (
    <section className="p2">
      <RainCard d={d} c={c} env={env} style={iv()} />
      <AqiCard c={c} d={d} env={env} style={iv()} />
      <LakeCard c={c} d={d} env={env} style={iv()} />
      <article className="card mk-card" style={{ ...iv(), gridColumn: "1 / -1" }}><MarketsCard ins={ins} c={c} /></article>
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
function useEnv(d: OverviewData, geo: MapGeo | null, c: Console, district = false) {
  const b = d.bottom;
  const zoneNo = district ? null : d.zone;
  const z = zoneNo && geo ? geo.zones.find((x) => x.zone === zoneNo) : null;
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
    if (sel === "all" || !zoneNo || !all.length) return { kind, stations: all, label: all.length === 1 ? all[0].name : `Average of ${all.length} ${noun}` };
    const inside = all.filter((s) => s.zone === zoneNo);
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
    <select className="sel" style={{ marginLeft: "auto", maxWidth: 170 }} value={c.envSel[kind] ?? "auto"} aria-label="Choose station"
      onChange={(e) => c.setEnvSel(kind, e.target.value)}>
      <option value="auto">All stations (average)</option>
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
